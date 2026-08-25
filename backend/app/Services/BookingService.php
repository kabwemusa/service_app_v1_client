<?php

namespace App\Services;

use App\Contracts\PaymentGateway;
use App\Contracts\TrustEngine;
use App\Enums\ErrorCode;
use App\Enums\TrustTier;
use App\Events\BookingAccepted;
use App\Events\BookingCompleted;
use App\Events\BookingDeclined;
use App\Events\BookingDelivered;
use App\Events\BookingQuoted;
use App\Events\BookingRequested;
use App\Events\BookingStarted;
use App\Events\PaymentMarked;
use App\Events\ReviewCreated;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\ForbiddenException;
use App\Exceptions\Api\NotFoundException;
use App\Jobs\ExpireBookingJob;
use App\Models\Booking;
use App\Models\Commission;
use App\Models\Dispute;
use App\Models\ProviderProfile;
use App\Models\Review;
use App\Models\Service;
use App\Models\ServiceAddon;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ranking\PersonalizationService;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Channel-agnostic booking lifecycle — escrow-first.
 *
 * New bookings (escrow):
 *   create → REQUESTED → QUOTED? → FUNDS_HELD → IN_PROGRESS → DELIVERED → COMPLETED → DISBURSED
 *          ↘ DECLINED / EXPIRED / CANCELLED / NO_SHOW / DISPUTED
 *
 * Legacy DIRECT bookings (legacy_payment_mode = 'DIRECT') retain their
 * original transitions for backward compatibility.
 */
class BookingService
{
    /**
     * Escrow states a BUYER may cancel from — i.e. every state before the
     * provider starts work.
     *
     * PENDING_PAYMENT and PAYMENT_FAILED are in here because a payment that was
     * never answered, or that failed, has moved no money and started no work;
     * omitting them (as this guard originally did) trapped customers in a
     * booking they could not get out of.
     *
     * Cancelling from PENDING_PAYMENT issues no refund — nothing has settled. If
     * the customer approves the prompt seconds later, the collection lands on an
     * already-CANCELLED booking and PaymentEventProcessor::refundLateCollection
     * reverses it, so their money is never kept.
     */
    private const BUYER_CANCELLABLE = [
        'REQUESTED',
        'QUOTED',
        'SCOPE_PENDING',
        'QUOTE_SENT',
        'PENDING_PAYMENT',
        'PAYMENT_FAILED',
        'FUNDS_HELD',
        'DEPOSIT_HELD',
    ];

    public function __construct(
        private readonly BookingConflictService   $conflict,
        private readonly PaymentService           $payment,
        private readonly PaymentGateway           $gateway,
        private readonly TrustEngine              $trust,
        private readonly CommissionService        $commission,
        private readonly InsuranceReserveService  $reserve,
        private readonly PersonalizationService   $personalization,
        private readonly BookingStateMachine      $machine,
        private readonly NotificationDispatcher   $notifications,
        private readonly PaymentReconciliationService $reconciliation,
        private readonly BookingAgreementService  $agreements,
        private readonly \App\Services\Growth\CampaignDiscountService $campaignDiscount,
    ) {}

    /**
     * Generate/refresh the Booking Agreement for a confirmed booking. Best-effort:
     * a render failure is logged inside the service and never blocks the money
     * flow. Called on confirmation and on any material change (cap extension).
     */
    public function issueAgreement(Booking $booking, string $reason): void
    {
        try {
            $this->agreements->generate($booking, $reason);
        } catch (\Throwable $e) {
            Log::warning('BookingService: agreement generation failed', [
                'booking_id' => $booking->id, 'error' => $e->getMessage(),
            ]);
        }
    }

    // ── Create (escrow-first) ───────────────────────────────────────────────

    public function create(User $buyer, array $data): Booking
    {
        // Buyer must be an active account. This is the single booking choke-point
        // for EVERY channel (app, PWA, WhatsApp), so a banned/suspended customer
        // cannot create a booking anywhere (§ SEC-9). The HTTP surface also has
        // EnsureAccountActive, but WhatsApp does not — this covers both.
        if ($buyer->account_state !== 'ACTIVE') {
            throw new ApiException(
                ErrorCode::ACCOUNT_RESTRICTED,
                'Your account is not active, so you cannot make a booking. Please contact support.',
            );
        }

        // CON-1 (double-tap): an Idempotency-Key makes booking creation safe to
        // retry. If we've already created a booking for this buyer+key, return it
        // instead of creating a duplicate (and a duplicate charge downstream).
        $idempotencyKey = $data['idempotency_key'] ?? null;
        if ($idempotencyKey) {
            $existing = Booking::where('idempotency_key', $idempotencyKey)
                ->where('buyer_id', $buyer->id)
                ->first();
            if ($existing) {
                return $this->findOrFail($existing->id, $buyer);
            }
        }

        $service = Service::find($data['service_id']);
        if (! $service || ! $service->isActive()) {
            throw new NotFoundException('Service');
        }

        $providerId = $data['provider_id'] ?? $service->provider_id;
        $provider = User::find($providerId);
        if (! $provider) {
            throw new NotFoundException('Provider');
        }

        if ($buyer->id === $provider->id) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'You cannot book your own service.');
        }

        $profile = ProviderProfile::where('user_id', $provider->id)->first();
        if (! $profile) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Provider profile is incomplete.');
        }

        if ($provider->account_state !== 'ACTIVE') {
            throw new ApiException(ErrorCode::ACCOUNT_RESTRICTED, 'This provider is not currently accepting bookings.');
        }

        if ($profile->trust_tier < 1) {
            throw new ApiException(ErrorCode::TIER_EXCEEDED, 'This provider has not completed identity verification yet.');
        }

        // Risk-tier eligibility gate — server-enforced
        $eligibility = $this->trust->checkEligibility($provider->id, $service->id);
        if (! $eligibility['eligible']) {
            // ERR-4: the internal gate keys go to the log, not the customer.
            Log::info('BookingService: eligibility gate failed', [
                'provider_id' => $provider->id, 'service_id' => $service->id,
                'missing'     => $eligibility['missing'] ?? [],
            ]);
            throw new ApiException(
                ErrorCode::TIER_EXCEEDED,
                'This provider isn\'t able to take this booking yet. Please choose another provider.',
            );
        }

        // Outcome-based pricing — the customer NEVER inputs hours. The booking
        // amount is derived entirely from provider-set price parameters:
        //   OUTCOME_FIXED  → fixed outcome price (+ confirmed add-ons)
        //   HOURLY_CAPPED  → the spend cap is held; actual time charged at completion
        //   PROVIDER_SCOPE / QUOTE_DEPOSIT → no amount yet; brief → scoped quote
        $addonTotal = 0.0;
        $addonIds   = $data['addon_ids'] ?? [];
        if (! empty($addonIds)) {
            $addonTotal = (float) ServiceAddon::where('service_id', $service->id)
                ->whereIn('id', $addonIds)
                ->sum('price');
        }

        $quoteFirst = $service->needsScopeQuote();

        $bookingAmount = match ($service->pricing_model) {
            'HOURLY_CAPPED' => round((float) ($service->cap_amount ?? ((float) $service->hourly_rate * (float) $service->cap_hours)) + $addonTotal, 2),
            'PROVIDER_SCOPE', 'QUOTE_DEPOSIT' => 0.0,
            // OUTCOME_FIXED (and any legacy FIXED rows not yet migrated)
            default => round((float) $service->base_price + $addonTotal, 2),
        };

        // Tier job cap: enforced now for priced models; quote-first models are
        // checked when the provider sends the scoped quote (price known then).
        $tier = TrustTier::from($profile->trust_tier);
        $cap  = $tier->jobCapZmw();

        if (! $quoteFirst && $cap !== null && $bookingAmount > $cap) {
            throw new ApiException(
                ErrorCode::TIER_EXCEEDED,
                "This provider's current tier limits bookings to ZMW {$cap}. "
                . 'They need additional verification to accept this booking.',
            );
        }

        // Scheduled end is a system-derived guide (provider's estimate / cap hours),
        // never a customer duration input. Clients may omit it entirely.
        $data['scheduled_end'] = $data['scheduled_end']
            ?? $this->deriveScheduledEnd($service, $data['scheduled_start']);

        // Remote (online) services carry no delivery location — the booking shows
        // "Online" everywhere an area would appear, and geo is bypassed. Time-slot
        // availability still applies.
        if ($service->isRemote()) {
            $data['delivery_lat']             = null;
            $data['delivery_lng']             = null;
            $data['delivery_location_label']  = config('catalog.online_location_label');
            $data['delivery_location_region'] = null;
            $data['delivery_location_source'] = null;
        } else {
            $data['delivery_lat'] = $data['delivery_lat'] ?? null;
            $data['delivery_lng'] = $data['delivery_lng'] ?? null;
        }

        $this->conflict->check(
            providerId:         $provider->id,
            scheduledStart:     $data['scheduled_start'],
            scheduledEnd:       $data['scheduled_end'],
            deliveryLat:        $data['delivery_lat'],
            deliveryLng:        $data['delivery_lng'],
            availabilityMatrix: $profile->availability_matrix ?? [],
        );

        $channel = $data['channel'] ?? 'APP';

        return $this->createEscrowBooking($buyer, $provider, $service, $data, $bookingAmount, $channel);
    }

    /**
     * Duration is a provider-set guide: the estimate for fixed outcomes, the
     * cap for hourly-capped, and a 2-hour placeholder for quote-first models
     * (refined when the provider's scoped quote lands).
     */
    private function deriveScheduledEnd(Service $service, string $scheduledStart): string
    {
        $mins = match ($service->pricing_model) {
            'HOURLY_CAPPED' => (int) round(((float) ($service->cap_hours ?? 2)) * 60),
            default         => $service->duration_estimate_mins ?? 120,
        };

        return (new \DateTimeImmutable($scheduledStart))
            ->modify("+{$mins} minutes")
            ->format(\DateTimeInterface::ATOM);
    }

    private function createEscrowBooking(
        User $buyer, User $provider, Service $service, array $data, float $amount, string $channel,
    ): Booking {
        $quoteFirst    = $service->needsScopeQuote();
        $protectionFee = $quoteFirst ? 0.0 : $this->commission->buyerProtectionFee($amount, $buyer->id, $provider->id);
        $addonIds      = ! empty($data['addon_ids']) ? json_encode(array_map('intval', $data['addon_ids'])) : null;
        $notes         = isset($data['notes']) && trim($data['notes']) !== '' ? trim($data['notes']) : null;
        $expiresAt     = now()->addHours(config('booking.response_window_hours', 24));

        // Quote-first models start at SCOPE_PENDING with the customer's structured
        // brief; the money fields are settled when the provider's quote is approved.
        $initialStatus = $quoteFirst ? 'SCOPE_PENDING' : 'REQUESTED';
        $scopeBrief    = ! empty($data['scope_brief']) ? json_encode($data['scope_brief']) : null;

        // Pre-compute the commission split for escrow (recomputed at quote/completion
        // whenever the final gross differs from this initial amount).
        $commissionPreview = $this->commission->calculate(
            gross:      $amount,
            categoryId: (int) $service->category_id,
            tier:       (int) ($provider->providerProfile?->trust_tier ?? 1),
            providerId: $provider->id,
            buyerId:    $buyer->id,
        );

        $idempotencyKey = $data['idempotency_key'] ?? null;

        try {
        $booking = DB::transaction(function () use (
            $buyer, $provider, $service, $data, $amount, $protectionFee,
            $addonIds, $notes, $expiresAt, $channel, $commissionPreview,
            $initialStatus, $scopeBrief, $idempotencyKey,
        ) {
            // CON-1 (slot race): serialize all concurrent booking creates for THIS
            // provider on a transaction-scoped advisory lock, then re-run the
            // conflict check under the lock so two simultaneous requests can't both
            // pass and double-book the same slot. Released automatically at commit.
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?)::bigint)', [$provider->id]);

            $this->conflict->check(
                providerId:         $provider->id,
                scheduledStart:     $data['scheduled_start'],
                scheduledEnd:       $data['scheduled_end'],
                deliveryLat:        $data['delivery_lat'],
                deliveryLng:        $data['delivery_lng'],
                availabilityMatrix: $provider->providerProfile?->availability_matrix ?? [],
            );

            $id = DB::selectOne("
                INSERT INTO bookings
                    (id, buyer_id, provider_id, service_id,
                     amount, buyer_protection_fee,
                     payment_mode, status, expires_at,
                     commission_split_zmw, provider_split_zmw,
                     channel,
                     scheduled_start, scheduled_end,
                     delivery_location,
                     delivery_location_label, delivery_location_region, delivery_location_source,
                     notes, selected_addon_ids, scope_brief, idempotency_key,
                     created_at, updated_at)
                VALUES
                    (gen_random_uuid(), ?, ?, ?,
                     ?, ?,
                     'ESCROW', ?, ?::timestamptz,
                     ?, ?,
                     ?,
                     ?::timestamptz, ?::timestamptz,
                     CASE WHEN ?::float8 IS NULL THEN NULL
                          ELSE ST_GeogFromText('POINT(' || ? || ' ' || ? || ')') END,
                     ?, ?, ?,
                     ?, ?::jsonb, ?::jsonb, ?,
                     NOW(), NOW())
                RETURNING id
            ", [
                $buyer->id, $provider->id, $service->id,
                $amount, $protectionFee,
                $initialStatus,
                $expiresAt->toIso8601String(),
                round($commissionPreview['commission'] + $commissionPreview['vat'], 2),
                round($commissionPreview['net_to_provider'], 2),
                $channel,
                $data['scheduled_start'],
                $data['scheduled_end'],
                $data['delivery_lng'],   // CASE null-guard
                $data['delivery_lng'],
                $data['delivery_lat'],
                $data['delivery_location_label']  ?? null,
                $data['delivery_location_region'] ?? null,
                $data['delivery_location_source'] ?? null,
                $notes,
                $addonIds,
                $scopeBrief,
                $idempotencyKey,
            ])->id;

            return $this->findOrFail($id, $buyer);
        });
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            // CON-1: a concurrent request with the same Idempotency-Key won the
            // insert first. Return that booking rather than surfacing an error.
            if ($idempotencyKey) {
                $existing = Booking::where('idempotency_key', $idempotencyKey)
                    ->where('buyer_id', $buyer->id)
                    ->first();
                if ($existing) {
                    return $this->findOrFail($existing->id, $buyer);
                }
            }
            throw $e;
        }

        $this->notify(new BookingRequested($booking, $this->buyerLabel($buyer)));
        ExpireBookingJob::dispatch($booking->id)
            ->delay(now()->addHours(config('booking.response_window_hours', 24)));

        return $booking;
    }

    // ── List ─────────────────────────────────────────────────────────────────

    public function list(User $user): LengthAwarePaginator
    {
        return Booking::with(['service.category', 'buyer', 'provider.providerProfile', 'review'])
            ->where(function ($q) use ($user) {
                $q->where('buyer_id', $user->id)
                  ->orWhere('provider_id', $user->id);
            })
            ->selectRaw('
                bookings.*,
                ST_Y(delivery_location::geometry) AS delivery_lat,
                ST_X(delivery_location::geometry) AS delivery_lng
            ')
            ->latest()
            ->paginate(20);
    }

    /**
     * §6.8 — incoming requests for the provider dashboard.
     *
     * Escrow: groups REQUESTED+QUOTED as "new" (need response),
     *         FUNDS_HELD+IN_PROGRESS as "scheduled" (committed work).
     * Legacy DIRECT: groups REQUESTED+QUOTED as "new",
     *                ACCEPTED+IN_PROGRESS as "scheduled".
     */
    public function incomingRequests(User $provider): array
    {
        $profile = ProviderProfile::where('user_id', $provider->id)->first();
        $tier    = TrustTier::from($profile?->trust_tier ?? 0);

        $activeStatuses = ['REQUESTED', 'QUOTED', 'SCOPE_PENDING', 'QUOTE_SENT', 'ACCEPTED', 'FUNDS_HELD', 'DEPOSIT_HELD', 'IN_PROGRESS'];

        $bookings = Booking::with(['service.category', 'buyer'])
            ->where('provider_id', $provider->id)
            ->whereIn('status', $activeStatuses)
            ->selectRaw('
                bookings.*,
                ST_Y(delivery_location::geometry) AS delivery_lat,
                ST_X(delivery_location::geometry) AS delivery_lng
            ')
            ->orderBy('scheduled_start')
            ->get();

        $entries = $bookings->map(function (Booking $booking) use ($provider, $profile, $tier) {
            $gross = (float) ($booking->agreed_amount ?? $booking->amount);
            $isLegacyDirect = $booking->legacy_payment_mode === 'DIRECT';

            $preview = $this->commission->calculate(
                gross:      $gross,
                categoryId: (int) ($booking->service->category_id ?? 0),
                tier:       $tier->value,
                providerId: $provider->id,
                buyerId:    $booking->buyer_id,
            );

            $statusLabel = match ($booking->status) {
                'REQUESTED'     => 'New request — respond or decline',
                'QUOTED'        => 'Quote sent — awaiting customer',
                'SCOPE_PENDING' => 'Brief received — review and send your quote',
                'QUOTE_SENT'    => 'Quote sent — awaiting customer approval',
                'ACCEPTED'      => 'Accepted — start when ready',
                'FUNDS_HELD'    => 'Funds held in escrow — start when ready',
                'DEPOSIT_HELD'  => 'Deposit held in escrow — balance collected at completion',
                'IN_PROGRESS'   => 'In progress',
                default         => $booking->status,
            };

            return [
                'booking_id'      => $booking->id,
                'payment_mode'    => $isLegacyDirect ? 'DIRECT' : 'ESCROW',
                'status'          => $booking->status,
                'channel'         => $booking->channel ?? 'APP',
                'service_title'   => $booking->service?->title,
                'pricing_model'   => $booking->service?->pricing_model,
                'scheduled_start' => $booking->scheduled_start?->toIso8601String(),
                'scheduled_end'   => $booking->scheduled_end?->toIso8601String(),
                'delivery_label'  => $booking->delivery_location_label,
                'delivery_region' => $booking->delivery_location_region,
                'distance_km'     => $this->distanceKm($profile, $booking->delivery_lat, $booking->delivery_lng),
                'gross_zmw'       => round($gross, 2),
                'net_zmw'         => $isLegacyDirect ? round($gross, 2) : round($preview['net_to_provider'], 2),
                'commission_rate' => $preview['effective_rate'],
                'escrow_label'    => $statusLabel,
                'buyer_label'     => $this->buyerLabel($booking->buyer),
                'trust_hint'      => $this->trustHint($booking->buyer, $provider->id),
                'created_at'      => $booking->created_at?->toIso8601String(),
            ];
        });

        $thisWeekNet = (float) Commission::where('provider_id', $provider->id)
            ->where('calculated_at', '>=', now()->subDays(7))
            ->sum('net_to_provider');

        $new       = $entries->whereIn('status', ['REQUESTED', 'QUOTED', 'SCOPE_PENDING', 'QUOTE_SENT'])->values()->all();
        $scheduled = $entries->whereIn('status', ['ACCEPTED', 'FUNDS_HELD', 'DEPOSIT_HELD', 'IN_PROGRESS'])->values()->all();

        return [
            'weekly' => [
                'this_week_zmw'  => round($thisWeekNet, 2),
                'weekly_cap_zmw' => $tier->weeklyCapZmw(),
            ],
            'response_nudge' => [
                'response_rate_7d' => $profile?->response_rate_7d !== null ? (float) $profile->response_rate_7d : null,
                'show'             => ($profile?->response_rate_7d ?? 1.0) < 0.8,
            ],
            'new'       => $new,
            'scheduled' => $scheduled,
        ];
    }

    // ── Escrow transitions ──────────────────────────────────────────────────

    /**
     * Provider sends a quote.
     *
     * Quote-first models (PROVIDER_SCOPE / QUOTE_DEPOSIT): a *scoped* quote —
     * price + duration + what's included — SCOPE_PENDING → QUOTE_SENT. For
     * QUOTE_DEPOSIT the deposit/balance split is fixed here from the service's
     * deposit_percent. Escrow is only held after the customer approves.
     *
     * Legacy path (REQUESTED → QUOTED) is kept for alternate-price quotes on
     * priced models.
     */
    public function quote(
        string $id, User $provider, float $proposedAmount, ?string $message = null,
        ?int $durationMins = null, array $inclusions = [],
    ): Booking {
        if ($proposedAmount <= 0) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Quote amount must be greater than zero.');
        }

        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $booking->load(['service', 'provider.providerProfile']);

        // Tier job cap — quote-first bookings skip the check at create (no price
        // yet), so the provider's quote is where it must hold.
        $tier = TrustTier::from((int) ($booking->provider->providerProfile?->trust_tier ?? 1));
        $cap  = $tier->jobCapZmw();
        if ($cap !== null && $proposedAmount > $cap) {
            throw new ApiException(
                ErrorCode::TIER_EXCEEDED,
                "Your current tier limits bookings to ZMW {$cap}. Complete additional verification to quote higher.",
            );
        }

        $isScoped = $booking->status === 'SCOPE_PENDING';
        $this->machine->assertTransition($booking, $isScoped ? 'QUOTE_SENT' : 'QUOTED');

        // The quote changes the gross — recompute protection fee and the escrow
        // split so the eventual hold and payout match the agreed price.
        $protectionFee = $this->commission->buyerProtectionFee($proposedAmount, $booking->buyer_id, $provider->id);
        $preview       = $this->commission->calculate(
            gross:      $proposedAmount,
            categoryId: (int) ($booking->service->category_id ?? 0),
            tier:       $tier->value,
            providerId: $provider->id,
            buyerId:    $booking->buyer_id,
        );

        $fields = [
            'status'               => $isScoped ? 'QUOTE_SENT' : 'QUOTED',
            'quoted_amount'        => $proposedAmount,
            'agreed_amount'        => $proposedAmount,
            'amount'               => $proposedAmount,
            'buyer_protection_fee' => $protectionFee,
            'quote_message'        => $message,
            'commission_split_zmw' => round($preview['commission'] + $preview['vat'], 2),
            'provider_split_zmw'   => round($preview['net_to_provider'], 2),
            'provider_quote'       => [
                'price'          => $proposedAmount,
                'duration_mins'  => $durationMins,
                'inclusions'     => array_values($inclusions),
                'message'        => $message,
                'quoted_at'      => now()->toIso8601String(),
            ],
        ];

        // QUOTE_DEPOSIT: two-phase escrow — deposit % now, balance at completion.
        if ($booking->service->pricing_model === 'QUOTE_DEPOSIT') {
            $pct     = (int) ($booking->service->deposit_percent ?? config('booking.quote_deposit_default_percent', 30));
            $deposit = round($proposedAmount * $pct / 100, 2);
            $fields['deposit_amount'] = $deposit;
            $fields['balance_amount'] = round($proposedAmount - $deposit, 2);
        }

        // Refine the guide end-time with the provider's scoped duration.
        if ($durationMins !== null && $booking->scheduled_start) {
            $fields['scheduled_end'] = $booking->scheduled_start->copy()->addMinutes($durationMins);
        }

        $booking->update($fields);

        $result = $this->findOrFail($id, $provider);
        $this->notify(new BookingQuoted($result));
        return $result;
    }

    /**
     * Customer approves the scoped quote — QUOTE_SENT → escrow hold.
     * Funds are only ever held AFTER this approval (deposit for QUOTE_DEPOSIT,
     * full amount otherwise).
     */
    public function approveQuote(string $id, User $buyer, ?string $payerPhoneOverride = null, ?string $promoCode = null): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $this->requireStatus($booking, 'QUOTE_SENT');

        return $this->holdFunds($id, $buyer, $payerPhoneOverride, $promoCode);
    }

    /**
     * Customer declines the scoped quote — QUOTE_SENT → CANCELLED, no charge.
     */
    public function declineQuote(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $this->requireStatus($booking, 'QUOTE_SENT');

        $booking->update(['status' => 'CANCELLED']);

        return $this->findOrFail($id, $buyer);
    }

    /**
     * Provider declines a REQUESTED/QUOTED booking.
     */
    public function decline(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->machine->assertTransition($booking, 'DECLINED');

        $booking->update(['status' => 'DECLINED']);

        $result = $this->findOrFail($id, $provider);
        $this->notify(new BookingDeclined($result));
        return $result;
    }

    /**
     * Dispatch cascade — move the booking to the next shortlisted provider
     * after a decline/timeout. Keeps the customer's agreed amount, but
     * recomputes the escrow split for the new provider's tier so the payout
     * is correct. Only valid while no work has started.
     */
    public function reassignProvider(string $id, string $newProviderId): Booking
    {
        $booking = Booking::with('service')->find($id);
        if (! $booking) {
            throw new NotFoundException('Booking');
        }

        if (! \in_array($booking->status, ['REQUESTED', 'QUOTED', 'SCOPE_PENDING', 'QUOTE_SENT', 'PENDING_PAYMENT', 'FUNDS_HELD'], true)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'This booking can no longer be reassigned.');
        }

        $newProvider = User::with('providerProfile')->find($newProviderId);
        if (! $newProvider || ! $newProvider->providerProfile) {
            throw new NotFoundException('Provider');
        }

        $gross = (float) ($booking->agreed_amount ?? $booking->amount);
        $preview = $this->commission->calculate(
            gross:      $gross,
            categoryId: (int) ($booking->service->category_id ?? 0),
            tier:       (int) $newProvider->providerProfile->trust_tier,
            providerId: $newProvider->id,
            buyerId:    $booking->buyer_id,
        );

        $fields = [
            'provider_id'          => $newProvider->id,
            'commission_split_zmw' => round($preview['commission'] + $preview['vat'], 2),
            'provider_split_zmw'   => round($preview['net_to_provider'], 2),
        ];

        // Quote-first: a prior provider's quote doesn't transfer — the new
        // provider reviews the same brief and quotes fresh.
        if (\in_array($booking->status, ['SCOPE_PENDING', 'QUOTE_SENT'], true)) {
            $fields['status']         = 'SCOPE_PENDING';
            $fields['provider_quote'] = null;
            $fields['quoted_amount']  = null;
            $fields['agreed_amount']  = null;
        }

        $booking->update($fields);

        return $booking->fresh();
    }

    /**
     * Buyer confirms and holds funds — REQUESTED/QUOTED → FUNDS_HELD.
     * This is the escrow payment step: customer pays via gateway, funds held.
     */
    public function holdFunds(string $id, User $buyer, ?string $payerPhoneOverride = null, ?string $promoCode = null): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $booking->load(['buyer', 'service', 'provider.providerProfile']);

        // Quote-first models must never take money before the customer approves
        // a scoped quote (SCOPE_PENDING has no price to hold).
        if ($booking->status === 'SCOPE_PENDING') {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'This booking is waiting for the provider\'s quote — payment comes after you approve it.',
            );
        }

        // The override lets a customer retry with a different Mobile Money
        // wallet (e.g. their MNO is down) without changing the account phone.
        $buyerPhone = $payerPhoneOverride
            ?? $booking->buyer->phone
            ?? throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Your account has no phone number on file.');

        $amount          = (float) ($booking->agreed_amount ?? $booking->amount);
        $commissionSplit = (float) ($booking->commission_split_zmw ?? 0);
        $providerSplit   = (float) ($booking->provider_split_zmw ?? $amount - $commissionSplit);
        $protectionFee   = (float) $booking->buyer_protection_fee;

        // QUOTE_DEPOSIT holds only the deposit at confirm; the balance is a
        // second collection at completion (two-phase escrow).
        $isDeposit   = $booking->service?->pricing_model === 'QUOTE_DEPOSIT' && $booking->deposit_amount !== null;
        $serviceHold = $isDeposit ? (float) $booking->deposit_amount : $amount;
        $heldState   = $isDeposit ? 'DEPOSIT_HELD' : 'FUNDS_HELD';

        $isAsync = config('lipila.enabled', false);

        if ($isAsync) {
            // "Resend payment prompt" calls holdFunds again while the booking is
            // still PENDING_PAYMENT (the first MoMo prompt was never answered).
            // That's a retry, not a state change — skip the assertion when we're
            // already there instead of treating it as illegal.
            if ($booking->status !== 'PENDING_PAYMENT') {
                $this->machine->assertTransition($booking, 'PENDING_PAYMENT');
            } elseif ($booking->escrow_hold_ref) {
                // TXN-2: a retry while a hold already exists must NOT mint a second
                // deposit (which would orphan the first ref and risk a double
                // charge). Check the existing deposit first: if it already
                // COMPLETED, advance instead of re-charging; if it is still
                // pending, keep waiting on that prompt; only a terminally failed
                // deposit is allowed to be re-issued.
                $existing = $this->gateway instanceof \App\Contracts\PaymentStatusVerifier
                    ? $this->gateway->verifyStatus('deposit', $booking->escrow_hold_ref)
                    : 'UNKNOWN';

                if ($existing === 'COMPLETED') {
                    $booking->update(['status' => $heldState]);
                    return $this->findOrFail($id, $buyer);
                }

                if (\in_array($existing, ['ACCEPTED', 'SUBMITTED', 'PENDING', 'PROCESSING', 'UNKNOWN'], true)) {
                    // A prompt is still outstanding (or its status is
                    // unconfirmable) — never create a competing charge.
                    //
                    // This used to return the booking unchanged, which is safe but
                    // SILENT: no log, and a client that cannot tell "prompt
                    // resent" from "nothing happened". Customers concluded the
                    // app was broken and kept tapping. Say what is going on.
                    //
                    // We deliberately do NOT auto-reissue after a timeout. The old
                    // reference stays on the booking, so if that stale collection
                    // ever completes, PaymentEventProcessor can still find it and
                    // refund it. Minting a second hold would move
                    // escrow_hold_ref to the new reference and orphan the old one
                    // — a completed orphan is money we would silently keep. The
                    // safe way out of a wedged prompt is to cancel and rebook.
                    $waitingMinutes = (int) $booking->updated_at?->diffInMinutes(now());

                    Log::info('BookingService::holdFunds — retry suppressed, a collection is still outstanding', [
                        'booking_id'      => $booking->id,
                        'escrow_hold_ref' => $booking->escrow_hold_ref,
                        'gateway_status'  => $existing,
                        'waiting_minutes' => $waitingMinutes,
                    ]);

                    throw new ApiException(
                        ErrorCode::CONFLICT,
                        $existing === 'UNKNOWN'
                            ? "We can't confirm your last payment attempt right now, so we won't charge you again. "
                                . 'Please wait a moment and check back — or cancel this booking and start again.'
                            : 'A payment prompt is already waiting on your phone. Approve it to continue '
                                . "(check your Mobile Money menu — on MTN dial *115#). If you've dismissed it, "
                                . 'cancel this booking and start again so you are not charged twice.',
                    );
                }
                // else: FAILED / REJECTED — fall through and issue a fresh hold.
            }
        } else {
            $this->machine->assertTransition($booking, $heldState);
        }

        // ── Growth & Promotions: apply a checkout discount ──────────────────
        // A live campaign / promo code reduces ONLY what the customer pays. The
        // provider split is NEVER touched — the provider is paid in full — so
        // Sebenza absorbs the discount out of its commission take (PERCENT/
        // AMOUNT_OFF) or waives the buyer protection fee (FREE_SERVICE_FEE), and
        // books it as spend against the campaign budget. Deposit holds are not
        // discounted this phase.
        if (! $isAsync) {
            // Sync (stub) path — apply() records the spend atomically with the
            // hold, so a gateway failure rolls back the ledger + budget too.
            DB::transaction(function () use (
                $booking, $buyer, $promoCode, $isDeposit, $serviceHold, $protectionFee,
                $amount, $commissionSplit, $providerSplit, $heldState, $buyerPhone,
            ) {
                $disc       = $this->campaignDiscount->apply($booking, $promoCode, $buyer, $isDeposit);
                $discount   = (float) $disc['discount_zmw'];
                $reducesFee = (bool) $disc['reduces_fee'];

                [$holdAmount, $newCommission] = $this->discountedHold(
                    $serviceHold, $protectionFee, $commissionSplit, $discount, $reducesFee,
                );

                $holdRef = $this->gateway->holdFunds(
                    $buyerPhone, $holdAmount, $booking->id, $newCommission, $providerSplit,
                );

                $booking->update([
                    'status'                => $heldState,
                    'escrow_hold_ref'       => $holdRef,
                    'agreed_amount'         => $amount,
                    'escrow_phase'          => $isDeposit ? 'DEPOSIT' : 'FULL',
                    'campaign_id'           => $disc['campaign_id'],
                    'campaign_discount_zmw' => $discount,
                    'promo_code'            => $discount > 0 ? $promoCode : null,
                    'commission_split_zmw'  => $newCommission,
                ]);
            });

            // Confirmed (funds custodied) → generate the Booking Agreement. The
            // async path does this from the Lipila webhook once funds settle.
            $this->issueAgreement($booking->fresh()->load(['service.category', 'service.inclusions', 'buyer', 'provider.providerProfile']), BookingAgreementService::REASON_CONFIRMATION);

            return $this->findOrFail($id, $buyer);
        }

        // Async (Lipila) path — the discount is fixed now so the MoMo prompt
        // charges the reduced amount; the spend is recorded when the deposit
        // settles (CampaignDiscountService::recordReserved in the callback).
        $preview    = $isDeposit ? null : $this->campaignDiscount->preview($booking, $promoCode, $buyer);
        $discount   = $preview ? (float) $preview['discount_zmw'] : 0.0;
        $reducesFee = $preview ? (bool) $preview['reduces_fee'] : false;

        [$holdAmount, $newCommission] = $this->discountedHold(
            $serviceHold, $protectionFee, $commissionSplit, $discount, $reducesFee,
        );

        $holdRef = $this->gateway->holdFunds(
            $buyerPhone, $holdAmount, $booking->id, $newCommission, $providerSplit,
        );

        $booking->update([
            'status'                => 'PENDING_PAYMENT',
            'escrow_hold_ref'       => $holdRef,
            'agreed_amount'         => $amount,
            'escrow_phase'          => $isDeposit ? 'DEPOSIT' : 'FULL',
            'campaign_id'           => $preview['campaign_id'] ?? null,
            'campaign_discount_zmw' => $discount,
            'promo_code'            => $discount > 0 ? $promoCode : null,
            'commission_split_zmw'  => $newCommission,
        ]);

        return $this->findOrFail($id, $buyer);
    }

    /**
     * The customer's reduced hold and Sebenza's reduced commission take for a
     * given campaign discount. The provider split is intentionally NOT an input
     * here — it never changes.
     *
     * @return array{0:float,1:float} [holdAmount, newCommissionSplit]
     */
    private function discountedHold(
        float $serviceHold, float $protectionFee, float $commissionSplit, float $discount, bool $reducesFee,
    ): array {
        if ($discount <= 0) {
            return [round($serviceHold + $protectionFee, 2), $commissionSplit];
        }

        if ($reducesFee) {
            // FREE_SERVICE_FEE waives the buyer protection fee; the service price
            // and the commission split are untouched.
            $payableFee = max(0.0, $protectionFee - $discount);
            return [round($serviceHold + $payableFee, 2), $commissionSplit];
        }

        // PERCENT/AMOUNT_OFF comes off the service price → off Sebenza's take.
        $payableService = max(0.0, $serviceHold - $discount);
        $newCommission  = round(max(0.0, $commissionSplit - $discount), 2);
        return [round($payableService + $protectionFee, 2), $newCommission];
    }

    // ── Legacy DIRECT transitions (backward compat for migrated bookings) ──

    /**
     * Provider accepts a legacy DIRECT booking — REQUESTED → ACCEPTED.
     */
    public function accept(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->requireLegacyDirect($booking);
        $this->machine->assertTransition($booking, 'ACCEPTED');

        $booking->update([
            'status'        => 'ACCEPTED',
            'agreed_amount' => $booking->agreed_amount ?? $booking->amount,
        ]);

        $result = $this->findOrFail($id, $provider);
        $this->notify(new BookingAccepted($result));
        return $result;
    }

    /**
     * Buyer accepts a provider's quote on a legacy DIRECT booking — QUOTED → ACCEPTED.
     */
    public function acceptQuote(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $this->requireLegacyDirect($booking);
        $this->machine->assertTransition($booking, 'ACCEPTED');

        $booking->update(['status' => 'ACCEPTED']);

        return $this->findOrFail($id, $buyer);
    }

    /**
     * Record that direct payment was made/received (legacy DIRECT mode only).
     */
    public function markPaid(string $id, User $user): Booking
    {
        $booking = Booking::find($id);
        if (! $booking) throw new NotFoundException('Booking');

        $isProvider = $booking->provider_id === $user->id;
        $isBuyer    = $booking->buyer_id === $user->id;
        if (! $isProvider && ! $isBuyer) {
            throw new ForbiddenException('You are not party to this booking.');
        }

        $this->requireLegacyDirect($booking);

        if (\in_array($booking->status, ['CANCELLED', 'DECLINED', 'EXPIRED'], true)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Cannot record payment for a closed booking.');
        }

        $booking->update([
            'payment_status'    => 'MARKED_PAID',
            'payment_marked_by' => $user->id,
            'payment_marked_at' => now(),
            $isProvider ? 'provider_marked_paid_at' : 'customer_marked_paid_at' => now(),
        ]);

        $result = $this->findOrFail($id, $user);
        $this->notify(new PaymentMarked($result, $isProvider ? 'provider' : 'customer'));
        return $result;
    }

    // ── Scope brief attachments (quote-first models) ─────────────────────────

    private const MAX_SCOPE_ATTACHMENTS = 8;
    private const MAX_SCOPE_VIDEOS      = 1;

    /**
     * Customer attaches photos / a short video to a quote-first brief
     * (PROVIDER_SCOPE / QUOTE_DEPOSIT) so the provider has visual context to
     * price the job — same idea as the text Q&A brief, just media. Buyer-only,
     * and only while the brief is still open (before the customer accepts a
     * quote and money moves).
     *
     * @param  \Illuminate\Http\UploadedFile[] $files
     */
    public function addScopeAttachments(string $id, User $buyer, array $files): Booking
    {
        $booking = Booking::with('service')->find($id);
        if (! $booking) {
            throw new NotFoundException('Booking');
        }
        if ($booking->buyer_id !== $buyer->id) {
            throw new ForbiddenException('You are not party to this booking.');
        }
        if (! $booking->service->needsScopeQuote()) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Attachments are only supported for quote-based services.');
        }
        if (! \in_array($booking->status, ['SCOPE_PENDING', 'QUOTE_SENT'], true)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Attachments can only be added while the brief is open.');
        }

        $existing       = $booking->scope_brief_attachments ?? [];
        $existingVideos = collect($existing)->where('type', 'video')->count();
        $newEntries     = [];

        foreach ($files as $file) {
            if (count($existing) + count($newEntries) >= self::MAX_SCOPE_ATTACHMENTS) {
                throw new ApiException(
                    ErrorCode::VALIDATION_ERROR,
                    'Maximum ' . self::MAX_SCOPE_ATTACHMENTS . ' attachments per booking.',
                );
            }

            $isVideo = str_starts_with((string) $file->getMimeType(), 'video/');
            $videoCount = $existingVideos + collect($newEntries)->where('type', 'video')->count();
            if ($isVideo && $videoCount >= self::MAX_SCOPE_VIDEOS) {
                throw new ApiException(
                    ErrorCode::VALIDATION_ERROR,
                    'Only ' . self::MAX_SCOPE_VIDEOS . ' video is allowed per booking.',
                );
            }

            // PRIVATE disk (§ SEC-4): these are photos of the customer's home /
            // property. They are streamed only to the two booking parties via the
            // authorized GET /bookings/{id}/scope-attachments/{index} route — never
            // served from a public URL.
            $path = $file->store("booking_attachments/{$booking->id}", 'local');
            $newEntries[] = ['path' => $path, 'type' => $isVideo ? 'video' : 'image'];
        }

        $booking->update(['scope_brief_attachments' => array_merge($existing, $newEntries)]);

        return $this->findOrFail($id, $buyer);
    }

    /**
     * Stream a private scope attachment to a party of the booking (§ SEC-4).
     * Authorizes on booking membership, bounds-checks the index, and returns the
     * file straight off the private disk. Throws for non-parties / bad index.
     */
    public function streamScopeAttachment(string $id, User $user, int $index): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $booking = Booking::find($id);
        if (! $booking) {
            throw new NotFoundException('Booking');
        }
        if ($booking->buyer_id !== $user->id && $booking->provider_id !== $user->id) {
            throw new ForbiddenException('You are not party to this booking.');
        }

        $attachments = $booking->scope_brief_attachments ?? [];
        $path = $attachments[$index]['path'] ?? null;

        if (! $path || ! \Illuminate\Support\Facades\Storage::disk('local')->exists($path)) {
            throw new NotFoundException('Attachment');
        }

        return \Illuminate\Support\Facades\Storage::disk('local')->response($path);
    }

    /**
     * System expiry for DIRECT REQUESTED bookings past the response window.
     * Called by BookingExpiryWorker; validates via state machine.
     */
    public function expire(string $bookingId): void
    {
        $booking = Booking::find($bookingId);
        if (! $booking) return;

        if ($this->machine->canTransition($booking, 'EXPIRED')) {
            $booking->update(['status' => 'EXPIRED']);
        }
    }

    // ── Legacy ESCROW-only transition (kept for old PENDING_PAYMENT bookings) ─

    public function confirmPayment(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $this->requireStatus($booking, 'PENDING_PAYMENT');
        $this->payment->initiatePayIn($booking);
        return $this->findOrFail($id, $buyer);
    }

    // ── Shared transitions (both modes) ──────────────────────────────────────

    /**
     * Provider starts work.
     * DIRECT: ACCEPTED → IN_PROGRESS  |  ESCROW: FUNDS_HELD → IN_PROGRESS
     */
    public function markInProgress(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $booking->load('service');
        $this->machine->assertTransition($booking, 'IN_PROGRESS');

        $fields = ['status' => 'IN_PROGRESS'];

        // HOURLY_CAPPED observed timer — "Start job" records the server start time.
        // The customer's app shows "Job started at {time}" and a live elapsed clock;
        // the elapsed time is never a client-entered number.
        if ($booking->service?->pricing_model === 'HOURLY_CAPPED'
            && ! $this->machine->isLegacyDirect($booking)
            && $booking->job_started_at === null) {
            $fields['job_started_at'] = now();
        }

        $booking->update($fields);
        $result = $this->findOrFail($id, $provider);
        $this->notify(new BookingStarted($result));
        return $result;
    }

    /**
     * HOURLY_CAPPED — pause / resume the observed timer (breaks, waiting on the
     * customer). Paused spans are excluded from billable time and kept as an
     * audit trail for disputes.
     */
    public function pauseJob(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->requireActiveHourlyTimer($booking);

        $events = $booking->pause_events ?? [];
        // Idempotent: ignore if already paused (last event has no resumed_at).
        $last = end($events);
        if ($last === false || ! empty($last['resumed_at'])) {
            $events[] = ['paused_at' => now()->toIso8601String(), 'resumed_at' => null];
            $booking->update(['pause_events' => $events]);
        }

        return $this->findOrFail($id, $provider);
    }

    public function resumeJob(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->requireActiveHourlyTimer($booking);

        $events = $booking->pause_events ?? [];
        $lastIdx = count($events) - 1;
        if ($lastIdx >= 0 && empty($events[$lastIdx]['resumed_at'])) {
            $events[$lastIdx]['resumed_at'] = now()->toIso8601String();
            $booking->update(['pause_events' => $events]);
        }

        return $this->findOrFail($id, $provider);
    }

    private function requireActiveHourlyTimer(Booking $booking): void
    {
        $booking->loadMissing('service');
        if ($booking->service?->pricing_model !== 'HOURLY_CAPPED'
            || $this->machine->isLegacyDirect($booking)
            || $booking->status !== 'IN_PROGRESS'
            || $booking->job_started_at === null) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'No active job timer to pause or resume.');
        }
    }

    /**
     * HOURLY_CAPPED — provider proposes a cap extension when the observed time is
     * approaching the approved cap. The customer must explicitly approve it
     * (re-authorising a higher hold); the cap is never exceeded silently.
     */
    public function requestCapExtension(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->requireActiveHourlyTimer($booking);

        $booking->update(['cap_extension_requested_at' => now()]);

        $result = $this->findOrFail($id, $provider);
        $this->notify(new \App\Events\BookingCapExtensionRequested($result));
        return $result;
    }

    /**
     * Customer approves a cap extension of `additionalHours` — re-authorises an
     * additional hold via the gateway and raises this booking's approved cap by
     * additionalHours × rate. Only valid while the job is running.
     */
    public function approveCapExtension(string $id, User $buyer, float $additionalHours, ?string $payerPhoneOverride = null): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $booking->load(['buyer', 'service']);

        if ($booking->service?->pricing_model !== 'HOURLY_CAPPED'
            || $booking->status !== 'IN_PROGRESS'
            || $booking->job_started_at === null) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'This job has no active timer to extend.');
        }
        if ($additionalHours <= 0 || fmod($additionalHours * 10, 5) > 0.001) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Extension time must be in 0.5-hour increments.');
        }

        $rate      = (float) ($booking->service->hourly_rate ?? 0);
        $extraZmw  = round($additionalHours * $rate, 2);
        $buyerPhone = $payerPhoneOverride
            ?? $booking->buyer->phone
            ?? throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Your account has no phone number on file.');

        // Re-authorise the extra hold via the gateway (Lipila MoMo prompt).
        $extRef = $this->gateway->holdFunds($buyerPhone, $extraZmw, $booking->id, 0.0, $extraZmw);

        $booking->update([
            'cap_extension_zmw'          => round((float) ($booking->cap_extension_zmw ?? 0) + $extraZmw, 2),
            'cap_extension_ref'          => $extRef,
            'cap_extension_requested_at' => null,
            // The held amount (the cap the customer approved) grows by the extension.
            'agreed_amount'              => round((float) ($booking->agreed_amount ?? $booking->amount) + $extraZmw, 2),
            'amount'                     => round((float) ($booking->amount ?? 0) + $extraZmw, 2),
        ]);

        // Material change → a new versioned agreement reflecting the raised cap.
        $this->issueAgreement($booking->fresh()->load(['service.category', 'service.inclusions', 'buyer', 'provider.providerProfile']), BookingAgreementService::REASON_CAP_EXTENSION);

        return $this->findOrFail($id, $buyer);
    }

    /**
     * Provider marks job delivered — IN_PROGRESS → DELIVERED (both modes).
     * This is the HOURLY_CAPPED "Finish" tap.
     *
     * HOURLY_CAPPED: the elapsed time is computed SERVER-SIDE from the start/stop
     * timestamps (job_started_at → now, minus any paused spans). There is NO
     * provider "enter hours" input. The charge = observed time rounded UP to the
     * provider's increment, ≥ minimum, ≤ the cap the customer approved; the
     * difference (hold − charge) is refunded to the customer at completion.
     */
    public function markDelivered(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $booking->load('service');
        $this->machine->assertTransition($booking, 'DELIVERED');

        $fields = ['status' => 'DELIVERED'];

        if ($booking->service?->pricing_model === 'HOURLY_CAPPED' && ! $this->machine->isLegacyDirect($booking)) {
            if ($booking->job_started_at === null) {
                throw new ApiException(
                    ErrorCode::VALIDATION_ERROR,
                    'Start the job timer before marking it finished.',
                );
            }

            $endedAt  = now();
            $observed = $this->computeObservedMinutes($booking, $endedAt);
            $charge   = $this->hourlyCappedCharge($booking, $observed);

            $fields['job_ended_at']     = $endedAt;
            $fields['observed_minutes'] = $observed;
            $fields['final_charge_zmw'] = $charge;
            // Keep the legacy column in sync (derived from the timer, never entered)
            // so downstream reporting/back-compat stays correct.
            $fields['actual_charge_zmw'] = $charge;
        }

        $booking->update($fields);
        $result = $this->findOrFail($id, $provider);
        $this->notify(new BookingDelivered($result));
        return $result;
    }

    /**
     * Server-computed billable minutes: wall-clock elapsed (start → end) minus
     * any paused spans. Never a client-entered number.
     */
    private function computeObservedMinutes(Booking $booking, \DateTimeInterface $endedAt): int
    {
        $start   = $booking->job_started_at;
        $elapsed = max(0, $endedAt->getTimestamp() - $start->getTimestamp());

        foreach ($booking->pause_events ?? [] as $span) {
            if (empty($span['paused_at'])) {
                continue;
            }
            $pausedAt  = strtotime($span['paused_at']);
            $resumedAt = ! empty($span['resumed_at']) ? strtotime($span['resumed_at']) : $endedAt->getTimestamp();
            $elapsed  -= max(0, $resumedAt - $pausedAt);
        }

        return (int) max(0, round($elapsed / 60));
    }

    /**
     * HOURLY_CAPPED final charge from observed minutes:
     *   round observed time UP to the provider's increment (config), enforce
     *   ≥ minimum hours and ≤ the approved cap (cap_amount + any customer-approved
     *   extension), plus the confirmed add-ons — never above the held amount.
     */
    private function hourlyCappedCharge(Booking $booking, int $observedMinutes): float
    {
        $service   = $booking->service;
        $rate      = (float) ($service->hourly_rate ?? 0);
        $increment = max(1, (int) config('booking.hourly.rounding_increment_mins', 30));

        // Round observed minutes UP to the billing increment.
        $roundedMins = (int) (ceil($observedMinutes / $increment) * $increment);

        // Enforce the minimum billable time.
        $minMins  = (int) round((float) ($service->minimum_hours ?? 0) * 60);
        $billable = max($roundedMins, $minMins);

        $addonTotal = 0.0;
        if (! empty($booking->selected_addon_ids)) {
            $addonTotal = (float) ServiceAddon::where('service_id', $service->id)
                ->whereIn('id', $booking->selected_addon_ids)
                ->sum('price');
        }

        // The approved cap = the held amount (cap + any customer-approved extension).
        $held   = (float) ($booking->agreed_amount ?? $booking->amount);
        $charge = ($billable / 60) * $rate + $addonTotal;

        return round(min($charge, $held), 2);
    }

    /**
     * Buyer confirms delivery — DELIVERED → COMPLETED.
     *
     * Escrow: records COLLECTED commission; sets payout hold timer.
     * Legacy DIRECT: records UNCOLLECTED commission; no payout.
     */
    public function complete(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $this->finalizeCompletion($booking);
        return $this->findOrFail($id, $buyer);
    }

    /**
     * System-initiated completion (dispute-window auto-complete). Runs the SAME
     * money flow as a customer confirmation — commission, payout timer, hourly
     * refund, balance collection — so auto-completed bookings actually pay out.
     * (Previously the worker only flipped the status and called the legacy
     * transaction-based payout, which stranded every gateway-funded booking.)
     */
    public function autoComplete(string $bookingId): void
    {
        $booking = Booking::find($bookingId);
        if (! $booking) {
            return;
        }
        $this->finalizeCompletion($booking);
    }

    /**
     * DELIVERED → COMPLETED for any pricing model.
     *
     * Escrow money flow at completion:
     *   OUTCOME_FIXED / PROVIDER_SCOPE — release the agreed amount (after hold).
     *   HOURLY_CAPPED — final charge = provider-logged actual time; the unused
     *     part of the cap is refunded to the customer via the gateway, and the
     *     commission/payout split is recomputed on the actual charge.
     *   QUOTE_DEPOSIT — the balance (quote − deposit) is collected as a second
     *     gateway deposit; the payout is gated on escrow_phase = FULL.
     */
    private function finalizeCompletion(Booking $booking): void
    {
        $this->machine->assertTransition($booking, 'COMPLETED');

        $booking->load(['service.category', 'buyer', 'provider.providerProfile']);

        if ($this->machine->isLegacyDirect($booking)) {
            DB::transaction(function () use ($booking) {
                $booking->update([
                    'status'       => 'COMPLETED',
                    'completed_at' => now(),
                ]);
                $this->commission->record($booking, 'DIRECT', 'UNCOLLECTED');
            });

            $this->personalization->invalidate($booking->buyer_id);
            $this->notify(new BookingCompleted($booking->fresh()->load('service')));
            return;
        }

        $model     = $booking->service?->pricing_model;
        $heldGross = (float) ($booking->agreed_amount ?? $booking->amount);

        // HOURLY_CAPPED: settle on the observed-timer charge computed at "Finish"
        // (final_charge_zmw is the source of truth; actual_charge_zmw mirrors it
        // for old rows). The hold was the cap; the unused difference is refunded.
        $finalGross   = $heldGross;
        $refundAmount = 0.0;
        if ($model === 'HOURLY_CAPPED') {
            $timerCharge = $booking->final_charge_zmw ?? $booking->actual_charge_zmw;
            if ($timerCharge !== null) {
                $finalGross   = (float) $timerCharge;
                $refundAmount = round(max($heldGross - $finalGross, 0), 2);
            }
        }

        // Escrow: payout hold logic
        $tier       = (int) ($booking->provider->providerProfile->trust_tier ?? 1);
        $holdHours  = TrustTier::from($tier)->payoutHoldHours();
        $eligibleAt = now()->addHours($holdHours);

        DB::transaction(function () use ($booking, $eligibleAt, $finalGross, $heldGross) {
            $fields = [
                'status'             => 'COMPLETED',
                'completed_at'       => now(),
                'payout_eligible_at' => $eligibleAt,
            ];

            // Settle the booking on the final gross and keep the payout split in
            // sync — disbursePayout releases provider_split_zmw verbatim.
            if (abs($finalGross - $heldGross) >= 0.01) {
                $preview = $this->commission->calculate(
                    gross:      $finalGross,
                    categoryId: (int) ($booking->service->category_id ?? 0),
                    tier:       (int) ($booking->provider->providerProfile->trust_tier ?? 1),
                    providerId: $booking->provider_id,
                    buyerId:    $booking->buyer_id,
                );
                $fields['agreed_amount']        = $finalGross;
                $fields['commission_split_zmw'] = round($preview['commission'] + $preview['vat'], 2);
                $fields['provider_split_zmw']   = round($preview['net_to_provider'], 2);
            }

            $booking->update($fields);
            $this->commission->record($booking->fresh(['service.category', 'provider.providerProfile']), 'ESCROW', 'COLLECTED');

            if ($booking->buyer_protection_fee > 0) {
                $this->reserve->credit($booking);
            }
        });

        // HOURLY_CAPPED: return the unused part of the cap to the customer.
        // Best-effort — a failed refund is logged for manual reconciliation and
        // never blocks the completion itself.
        if ($refundAmount >= 0.01 && $booking->escrow_hold_ref) {
            try {
                $refundRef = $this->gateway->refund(
                    $booking->escrow_hold_ref,
                    $booking->buyer?->phone ?? '',
                    $refundAmount,
                );
                if (! $refundRef) {
                    throw new \RuntimeException('Gateway refund returned failure.');
                }
                $booking->update(['refund_ref' => $refundRef]);
                Log::info('BookingService: hourly-capped unused-cap refund initiated', [
                    'booking_id' => $booking->id, 'refund_zmw' => $refundAmount, 'refund_ref' => $refundRef,
                ]);
            } catch (\Throwable $e) {
                Log::error('BookingService: hourly-capped refund failed — queued for reconciliation', [
                    'booking_id' => $booking->id, 'refund_zmw' => $refundAmount, 'error' => $e->getMessage(),
                ]);
                $this->reconciliation->record(
                    $booking, \App\Models\PaymentReconciliation::KIND_REFUND,
                    $refundAmount, $booking->escrow_hold_ref, $booking->buyer?->phone, $e->getMessage(),
                );
            }
        }

        // QUOTE_DEPOSIT: second collection for the balance (deposit was held at
        // confirm). The payout stays gated until the balance deposit completes.
        if ($model === 'QUOTE_DEPOSIT' && (float) $booking->balance_amount >= 0.01
            && $booking->escrow_phase !== 'FULL') {
            $this->collectBalance($booking);
        }

        $this->personalization->invalidate($booking->buyer_id);
        $this->notify(new BookingCompleted($booking->fresh()->load('service')));

        if ($eligibleAt->isPast()) {
            $this->disbursePayout($booking->fresh()->load('service', 'provider.providerProfile'));
        }
    }

    /**
     * QUOTE_DEPOSIT phase 2 — collect the balance via a second gateway deposit
     * against the same booking reference. Async gateways confirm through the
     * Lipila webhook (balance_hold_ref → escrow_phase FULL); the stub confirms
     * inline. A failure leaves escrow_phase = DEPOSIT so it can be retried.
     */
    public function collectBalance(Booking $booking): void
    {
        $booking->loadMissing(['buyer', 'service']);

        $buyerPhone = $booking->buyer?->phone;
        if (! $buyerPhone) {
            Log::error('BookingService::collectBalance — buyer has no phone', ['booking_id' => $booking->id]);
            return;
        }

        try {
            $balanceRef = $this->gateway->holdFunds(
                $buyerPhone,
                (float) $booking->balance_amount,
                $booking->id,
                0.0,
                (float) $booking->balance_amount,
            );
        } catch (\Throwable $e) {
            Log::error('BookingService::collectBalance — balance collection failed, queued for reconciliation', [
                'booking_id' => $booking->id, 'error' => $e->getMessage(),
            ]);
            $this->reconciliation->record(
                $booking, \App\Models\PaymentReconciliation::KIND_BALANCE,
                (float) $booking->balance_amount, $booking->escrow_hold_ref, $buyerPhone, $e->getMessage(),
            );
            return;
        }

        $booking->update([
            'balance_hold_ref' => $balanceRef,
            'escrow_phase'     => config('lipila.enabled', false) ? 'BALANCE' : 'FULL',
        ]);

        Log::info('BookingService: balance collection initiated', [
            'booking_id' => $booking->id,
            'balanceRef' => $balanceRef,
            'amount'     => (float) $booking->balance_amount,
        ]);
    }

    /**
     * Release escrow funds to the provider via the PaymentGateway. Public so
     * the admin Finance module can retry a failed payout (AdminFinanceService)
     * — same logic, no new disbursement path.
     */
    public function disbursePayout(Booking $booking): void
    {
        // QUOTE_DEPOSIT: never release until BOTH collections are custodied
        // (deposit at confirm + balance at completion → escrow_phase FULL).
        if ($booking->balance_amount !== null
            && (float) $booking->balance_amount >= 0.01
            && $booking->escrow_phase !== 'FULL') {
            Log::info('BookingService::disbursePayout — waiting for balance collection', [
                'booking_id' => $booking->id, 'escrow_phase' => $booking->escrow_phase,
            ]);
            return;
        }

        if (! $booking->escrow_hold_ref) {
            // Fall back to legacy payment service for old ESCROW bookings
            $this->payment->initiatePayout($booking);
            return;
        }

        $profile = $booking->provider->providerProfile;
        if (! $profile?->momo_number) {
            Log::error('BookingService::disbursePayout — provider has no MoMo number', ['booking_id' => $booking->id]);
            return;
        }

        // ── Atomic claim (TXN-1) ────────────────────────────────────────────
        // The due-payout batch, instant-payout, finalizeCompletion and the
        // balance-completed callback can all reach this for the SAME booking. A
        // single conditional UPDATE lets exactly one of them proceed: only a
        // COMPLETED, not-yet-disbursed booking whose claim is free (or stale >15m,
        // so a crashed claim self-heals) is claimed. Everyone else no-ops. The
        // gateway call happens only AFTER we own the claim, so releaseFunds runs
        // once per booking.
        $claimed = DB::table('bookings')
            ->where('id', $booking->id)
            ->where('status', 'COMPLETED')
            ->whereNull('disbursed_at')
            ->where(function ($q) {
                $q->whereNull('payout_claimed_at')
                  ->orWhere('payout_claimed_at', '<', now()->subMinutes(15));
            })
            ->update(['payout_claimed_at' => now()]);

        if ($claimed === 0) {
            Log::info('BookingService::disbursePayout — booking already claimed/disbursed, skipping', [
                'booking_id' => $booking->id, 'status' => $booking->status,
            ]);
            return;
        }

        $amount = (float) ($booking->provider_split_zmw ?? $booking->amount);

        try {
            $payoutRef = $this->gateway->releaseFunds(
                $booking->escrow_hold_ref,
                $profile->momo_number,
                $amount,
                $booking->id,
            );
        } catch (\Throwable $e) {
            // Release the claim so the due-payout batch can retry (MNO outage etc.),
            // and durably queue it so a lost batch cycle can't strand the payout.
            DB::table('bookings')->where('id', $booking->id)->update(['payout_claimed_at' => null]);
            Log::error('BookingService::disbursePayout — gateway threw, claim released and queued for reconciliation', [
                'booking_id' => $booking->id, 'error' => $e->getMessage(),
            ]);
            $this->reconciliation->record(
                $booking, \App\Models\PaymentReconciliation::KIND_PAYOUT,
                $amount, $booking->escrow_hold_ref, $profile->momo_number, $e->getMessage(),
            );
            return;
        }

        if ($payoutRef !== null) {
            // Persist the payout reference BEFORE the async callback can arrive —
            // PaymentEventProcessor::payout looks the booking
            // up by this column, the same reliable pattern escrow_hold_ref uses
            // for deposits.
            $booking->update(['status' => 'DISBURSED', 'disbursed_at' => now(), 'payout_ref' => $payoutRef]);
            $this->notify(new \App\Events\PayoutReleased($booking));
        } else {
            // Failed to initiate — free the claim so it is retried, not stranded,
            // and queue a durable reconciliation as a belt-and-braces backstop.
            DB::table('bookings')->where('id', $booking->id)->update(['payout_claimed_at' => null]);
            Log::error('BookingService::disbursePayout — gateway release failed, queued for reconciliation', ['booking_id' => $booking->id]);
            $this->reconciliation->record(
                $booking, \App\Models\PaymentReconciliation::KIND_PAYOUT,
                $amount, $booking->escrow_hold_ref, $profile->momo_number, 'Gateway release returned null.',
            );
        }
    }

    /**
     * Buyer leaves a review for a completed booking (v3 §7.1). One review per
     * booking; a DB trigger keeps the provider's r_raw / v_reviews in sync.
     */
    public function review(string $id, User $buyer, float $rating, ?string $comment): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');

        if (! in_array($booking->status, ['COMPLETED', 'DISBURSED'], true)) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'You can only review a booking once it is completed.',
            );
        }

        if ($booking->review()->exists()) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'You have already reviewed this booking.',
            );
        }

        $review = Review::create([
            'booking_id'  => $booking->id,
            'reviewer_id' => $buyer->id,
            'reviewee_id' => $booking->provider_id,
            'rating'      => $rating,
            'comment'     => $comment !== null && trim($comment) !== '' ? trim($comment) : null,
        ]);

        $this->notify(new ReviewCreated($review));
        $this->personalization->invalidate($buyer->id);

        return $this->findOrFail($id, $buyer);
    }

    /**
     * Provider requests instant payout — escrow only (Tier 3+, waives hold for 1% fee).
     */
    public function requestInstantPayout(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');

        if ($booking->status !== 'COMPLETED') {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Instant payout is only available for COMPLETED bookings.');
        }

        if ($this->machine->isLegacyDirect($booking)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Instant payout is not available for legacy DIRECT bookings.');
        }

        $profile = ProviderProfile::where('user_id', $provider->id)->firstOrFail();
        $tier    = TrustTier::from($profile->trust_tier);

        if (! $tier->hasInstantPayout()) {
            throw new ApiException(ErrorCode::TIER_EXCEEDED, 'Instant payout requires Tier 3 or higher.');
        }

        $booking->update([
            'instant_payout_requested' => true,
            'payout_eligible_at'       => now(),
        ]);

        $booking = $booking->fresh()->load('service', 'provider.providerProfile');
        $this->disbursePayout($booking);

        return $this->findOrFail($id, $provider);
    }

    /**
     * Buyer cancels.
     *
     * Legacy DIRECT: allowed from REQUESTED / QUOTED / ACCEPTED; no refund.
     * Escrow: allowed from REQUESTED / QUOTED / FUNDS_HELD; refunds if funds held.
     */
    public function cancel(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');

        if ($this->machine->isLegacyDirect($booking)) {
            if (! \in_array($booking->status, ['REQUESTED', 'QUOTED', 'ACCEPTED'], true)) {
                throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Booking can only be cancelled before the provider starts work.');
            }
            $booking->update(['status' => 'CANCELLED']);
            return $this->findOrFail($id, $buyer);
        }

        // Escrow cancellation.
        //
        // This list is deliberately NARROWER than what the state machine permits:
        // the machine also allows DISPUTED → CANCELLED, but that belongs to an
        // admin resolving a dispute, not to the buyer walking away from one (and
        // it would cancel without refunding, since DISPUTED is not a funds-held
        // state). Buyer authority ends the moment the provider starts work.
        if (! \in_array($booking->status, self::BUYER_CANCELLABLE, true)) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'Booking can only be cancelled before the provider starts work.',
            );
        }

        // TXN-3: never call the gateway inside a DB transaction. We first move the
        // booking to CANCELLED with an ATOMIC, refund-claiming update (so a
        // double-tapped cancel can't issue two refunds), then call the gateway
        // AFTER commit. refunded_at is the idempotency marker: only the update
        // that actually flips the status (and claims the refund) proceeds to pay.
        $needsRefund = \in_array($booking->status, ['FUNDS_HELD', 'DEPOSIT_HELD'], true) && $booking->escrow_hold_ref;

        $held = $booking->status === 'DEPOSIT_HELD'
            ? (float) $booking->deposit_amount
            : (float) ($booking->agreed_amount ?? $booking->amount);
        $refundAmount = $held + (float) $booking->buyer_protection_fee;
        $buyerPhone   = $booking->buyer->phone ?? '';
        $holdRef      = $booking->escrow_hold_ref;
        $legacyFundsHeld = ! $needsRefund && $booking->status === 'FUNDS_HELD';

        // Atomic transition: claim the cancellation (and, when funds are held, the
        // refund) in one conditional update keyed on the current status.
        $claimed = DB::table('bookings')
            ->where('id', $booking->id)
            ->where('status', $booking->status)
            ->update(array_merge(
                ['status' => 'CANCELLED', 'updated_at' => now()],
                $needsRefund ? ['refunded_at' => now()] : [],
            ));

        if ($claimed === 0) {
            // Someone already transitioned it (double-tap / race) — no double refund.
            return $this->findOrFail($id, $buyer);
        }

        // Post-commit external calls (best-effort; a failure is logged for
        // reconciliation and never rolls the cancellation back onto held funds).
        if ($needsRefund) {
            try {
                $refundRef = $this->gateway->refund($holdRef, $buyerPhone, $refundAmount);
                if (! $refundRef) {
                    throw new \RuntimeException('Gateway refund returned failure.');
                }
                $booking->update(['refund_ref' => $refundRef]);
            } catch (\Throwable $e) {
                Log::error('BookingService::cancel — refund failed, queued for reconciliation', [
                    'booking_id' => $booking->id, 'refund_zmw' => $refundAmount, 'error' => $e->getMessage(),
                ]);
                $this->reconciliation->record(
                    $booking, \App\Models\PaymentReconciliation::KIND_REFUND,
                    $refundAmount, $holdRef, $buyerPhone, $e->getMessage(),
                );
            }
        } elseif ($legacyFundsHeld) {
            try {
                $this->payment->initiateRefund($booking->fresh());
            } catch (\Throwable $e) {
                Log::error('BookingService::cancel — legacy refund failed, needs manual reconciliation', [
                    'booking_id' => $booking->id, 'error' => $e->getMessage(),
                ]);
            }
        }

        return $this->findOrFail($id, $buyer);
    }

    /**
     * Initiate chargeback — COMPLETED/DISBURSED → CHARGEBACK_PENDING (ESCROW).
     */
    public function initiateChargeback(string $bookingId): Booking
    {
        $booking = Booking::findOrFail($bookingId);

        if (! \in_array($booking->status, ['COMPLETED', 'DISBURSED'], true)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Chargeback can only be initiated on COMPLETED or DISBURSED bookings.');
        }

        DB::transaction(function () use ($booking) {
            $booking->update(['status' => 'CHARGEBACK_PENDING']);

            Transaction::where('booking_id', $booking->id)
                ->where('type', 'PAY_OUT')
                ->where('status', 'PENDING')
                ->update(['status' => 'FROZEN']);

            Log::warning('BookingService: chargeback initiated', ['booking_id' => $booking->id]);
        });

        Dispute::firstOrCreate(
            ['booking_id' => $booking->id],
            [
                'raised_by'       => $booking->buyer_id,
                'against'         => $booking->provider_id,
                'reason_category' => 'CHARGEBACK',
                'description'     => 'Chargeback initiated by card network.',
                'status'          => 'AWAITING_EVIDENCE',
                'opened_at'       => now(),
            ],
        );

        return $booking->fresh();
    }

    // ── Payout batch (ESCROW only) ────────────────────────────────────────────

    /**
     * Process COMPLETED escrow bookings whose payout hold has expired.
     * Legacy DIRECT bookings are skipped.
     */
    public function processDuePayouts(): array
    {
        $due = Booking::where('status', 'COMPLETED')
            ->where('payment_mode', 'ESCROW')
            ->whereNull('legacy_payment_mode')
            ->where('payout_eligible_at', '<=', now())
            ->whereNull('disbursed_at')
            ->with(['service', 'provider.providerProfile'])
            ->get();

        $succeeded = 0;
        $failed    = 0;

        foreach ($due as $booking) {
            try {
                $this->disbursePayout($booking);
                $succeeded++;
            } catch (\Throwable $e) {
                $failed++;
                Log::error('BookingService::processDuePayouts failed', [
                    'booking_id' => $booking->id,
                    'error'      => $e->getMessage(),
                ]);
            }
        }

        return compact('succeeded', 'failed');
    }

    // ── findOrFail ────────────────────────────────────────────────────────────

    public function findOrFail(string $id, User $user): Booking
    {
        $rows = DB::select('
            SELECT
                bookings.*,
                ST_Y(delivery_location::geometry) AS delivery_lat,
                ST_X(delivery_location::geometry) AS delivery_lng
            FROM bookings
            WHERE id = ?
            LIMIT 1
        ', [$id]);

        if (empty($rows)) {
            throw new NotFoundException('Booking');
        }

        $row = $rows[0];

        if ($row->buyer_id !== $user->id && $row->provider_id !== $user->id) {
            throw new ForbiddenException('You are not party to this booking.');
        }

        $booking = Booking::find($id);
        $booking->delivery_lat = $row->delivery_lat !== null ? (float) $row->delivery_lat : null;
        $booking->delivery_lng = $row->delivery_lng !== null ? (float) $row->delivery_lng : null;

        $booking->load(['service.category', 'buyer', 'provider.providerProfile', 'transactions', 'commission', 'dispute', 'review', 'statusUpdates']);

        // Provider-facing, qualitative buyer trust hint (§10.2) + privacy-safe label.
        $booking->setAttribute('buyer_trust_hint', $this->trustHint($booking->buyer, $booking->provider_id));
        $booking->setAttribute('buyer_label',      $this->buyerLabel($booking->buyer));

        // Auto-confirm deadline while DELIVERED (DELIVERED→COMPLETED after autoconfirm_hours).
        $booking->setAttribute(
            'auto_release_at',
            $booking->status === 'DELIVERED' && $booking->updated_at
                ? $booking->updated_at->copy()->addHours(\App\Support\Settings::int('autoconfirm_hours', (int) config('booking.autoconfirm_hours', 24)))->toISOString()
                : null,
        );

        return $booking;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private function loadAndAuthorize(string $id, User $user, string $column): Booking
    {
        $booking = Booking::find($id);

        if (! $booking) {
            throw new NotFoundException('Booking');
        }

        if ($booking->{$column} !== $user->id) {
            throw new ForbiddenException('You are not authorised to perform this action.');
        }

        return $booking;
    }

    private function requireStatus(Booking $booking, string $expected): void
    {
        if ($booking->status !== $expected) {
            // ERR-4: don't surface internal state names to the client — that detail
            // goes to the log; the user gets an actionable, generic message.
            Log::info('BookingService: status precondition failed', [
                'booking_id' => $booking->id, 'expected' => $expected, 'actual' => $booking->status,
            ]);
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'This action isn\'t available for the booking right now. Refresh and try again.',
            );
        }
    }

    private function requireLegacyDirect(Booking $booking): void
    {
        if (! $this->machine->isLegacyDirect($booking)) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'This action is only available for legacy DIRECT bookings.',
            );
        }
    }

    /** Fire a notification without letting failures crash the business operation. */
    private function notify(\App\Events\NotifiableEvent $event): void
    {
        try {
            $this->notifications->dispatch($event);
        } catch (\Throwable $e) {
            Log::error('BookingService: notification failed', [
                'type' => $event->notificationType(), 'error' => $e->getMessage(),
            ]);
        }
    }

    /** §8 — qualitative buyer trust hint; never expose the raw risk score. */
    private function trustHint(?User $buyer, string $providerId): string
    {
        if (! $buyer) return 'NEW';

        // § DB-5 — reuse the commission service's memoized pair count instead of a
        // separate exists() query per row (same key, one query per distinct buyer).
        $isRepeat = $this->commission->pairBookingNumber($buyer->id, $providerId) > 1;

        if ($isRepeat) return 'REPEAT_CLIENT';

        if ($buyer->risk_score !== null && (float) $buyer->risk_score <= 0.3) return 'TRUSTED';

        return 'NEW';
    }

    private function buyerLabel(?User $buyer): string
    {
        if (! $buyer) return 'Customer';
        if (! empty($buyer->legal_name)) return explode(' ', trim($buyer->legal_name))[0];
        if ($buyer->email) return ucfirst(explode('@', $buyer->email)[0]);
        // Never expose a raw phone as the "privacy-safe" label (§ SEC-5): mask it
        // to the last 3 digits so the provider gets a stable handle, not a number.
        if ($buyer->phone) {
            $digits = preg_replace('/\D/', '', $buyer->phone);
            return strlen($digits) >= 3 ? 'Customer ' . substr($digits, -3) : 'Customer';
        }
        return 'Customer';
    }

    private function distanceKm(?ProviderProfile $profile, ?float $lat, ?float $lng): ?float
    {
        if (! $profile || $profile->base_location_lat === null || $profile->base_location_lng === null
            || $lat === null || $lng === null) {
            return null;
        }

        $R    = 6371.0;
        $dLat = deg2rad($lat - $profile->base_location_lat);
        $dLng = deg2rad($lng - $profile->base_location_lng);
        $a    = sin($dLat / 2) ** 2
            + cos(deg2rad($profile->base_location_lat)) * cos(deg2rad($lat)) * sin($dLng / 2) ** 2;

        return round($R * 2 * atan2(sqrt($a), sqrt(1 - $a)), 1);
    }
}
