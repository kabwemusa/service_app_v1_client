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
    ) {}

    // ── Create (escrow-first) ───────────────────────────────────────────────

    public function create(User $buyer, array $data): Booking
    {
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
            $missing = implode(', ', $eligibility['missing']);
            throw new ApiException(
                ErrorCode::TIER_EXCEEDED,
                "This provider does not meet the eligibility requirements for this service (missing: {$missing}).",
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

        $booking = DB::transaction(function () use (
            $buyer, $provider, $service, $data, $amount, $protectionFee,
            $addonIds, $notes, $expiresAt, $channel, $commissionPreview,
            $initialStatus, $scopeBrief,
        ) {
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
                     notes, selected_addon_ids, scope_brief,
                     created_at, updated_at)
                VALUES
                    (gen_random_uuid(), ?, ?, ?,
                     ?, ?,
                     'ESCROW', ?, ?::timestamptz,
                     ?, ?,
                     ?,
                     ?::timestamptz, ?::timestamptz,
                     ST_GeogFromText('POINT(' || ? || ' ' || ? || ')'),
                     ?, ?, ?,
                     ?, ?::jsonb, ?::jsonb,
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
                $data['delivery_lng'],
                $data['delivery_lat'],
                $data['delivery_location_label']  ?? null,
                $data['delivery_location_region'] ?? null,
                $data['delivery_location_source'] ?? null,
                $notes,
                $addonIds,
                $scopeBrief,
            ])->id;

            return $this->findOrFail($id, $buyer);
        });

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
            $pct     = (int) ($booking->service->deposit_percent ?? 30);
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
    public function approveQuote(string $id, User $buyer, ?string $payerPhoneOverride = null): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $this->requireStatus($booking, 'QUOTE_SENT');

        return $this->holdFunds($id, $buyer, $payerPhoneOverride);
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
    public function holdFunds(string $id, User $buyer, ?string $payerPhoneOverride = null): Booking
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

        // QUOTE_DEPOSIT holds only the deposit at confirm; the balance is a
        // second collection at completion (two-phase escrow).
        $isDeposit  = $booking->service?->pricing_model === 'QUOTE_DEPOSIT' && $booking->deposit_amount !== null;
        $holdAmount = ($isDeposit ? (float) $booking->deposit_amount : $amount)
            + (float) $booking->buyer_protection_fee;
        $heldState  = $isDeposit ? 'DEPOSIT_HELD' : 'FUNDS_HELD';

        $isAsync = config('pawapay.enabled', false);

        if ($isAsync) {
            // "Resend payment prompt" calls holdFunds again while the booking is
            // still PENDING_PAYMENT (the first MoMo prompt was never answered).
            // That's a retry, not a state change — skip the assertion when we're
            // already there instead of treating it as illegal.
            if ($booking->status !== 'PENDING_PAYMENT') {
                $this->machine->assertTransition($booking, 'PENDING_PAYMENT');
            }
        } else {
            $this->machine->assertTransition($booking, $heldState);
        }

        $holdRef = $this->gateway->holdFunds(
            $buyerPhone, $holdAmount,
            $booking->id, $commissionSplit, $providerSplit,
        );

        if ($isAsync) {
            // PawaPay: deposit initiated, MoMo prompt sent to customer. Callback
            // advances to FUNDS_HELD / DEPOSIT_HELD (per escrow_phase) on confirm.
            $booking->update([
                'status'          => 'PENDING_PAYMENT',
                'escrow_hold_ref' => $holdRef,
                'agreed_amount'   => $amount,
                'escrow_phase'    => $isDeposit ? 'DEPOSIT' : 'FULL',
            ]);
        } else {
            // Stub: instant success.
            $booking->update([
                'status'          => $heldState,
                'escrow_hold_ref' => $holdRef,
                'agreed_amount'   => $amount,
                'escrow_phase'    => $isDeposit ? 'DEPOSIT' : 'FULL',
            ]);
        }

        return $this->findOrFail($id, $buyer);
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
        $this->machine->assertTransition($booking, 'IN_PROGRESS');
        $booking->update(['status' => 'IN_PROGRESS']);
        $result = $this->findOrFail($id, $provider);
        $this->notify(new BookingStarted($result));
        return $result;
    }

    /**
     * Provider marks job delivered — IN_PROGRESS → DELIVERED (both modes).
     *
     * HOURLY_CAPPED: the provider logs the actual time worked here (structured,
     * 0.5-hr increments, never customer input). The final charge is
     * max(actual, minimum) × rate, capped at the held cap; the difference is
     * refunded to the customer at completion.
     */
    public function markDelivered(string $id, User $provider, ?float $actualHours = null): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $booking->load('service');
        $this->machine->assertTransition($booking, 'DELIVERED');

        $fields = ['status' => 'DELIVERED'];

        if ($booking->service?->pricing_model === 'HOURLY_CAPPED' && ! $this->machine->isLegacyDirect($booking)) {
            if ($actualHours === null) {
                throw new ApiException(
                    ErrorCode::VALIDATION_ERROR,
                    'Log the actual time worked (in half-hour steps) to mark this job done.',
                );
            }
            if (fmod($actualHours * 10, 5) > 0.001 || $actualHours <= 0) {
                throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Actual time must be in 0.5-hour increments.');
            }
            $capHours = (float) ($booking->service->cap_hours ?? $actualHours);
            if ($actualHours > $capHours) {
                throw new ApiException(
                    ErrorCode::VALIDATION_ERROR,
                    "Actual time can't exceed the booked cap of {$capHours} hours.",
                );
            }

            $fields['actual_hours_logged'] = $actualHours;
            $fields['actual_charge_zmw']   = $this->hourlyCappedCharge($booking, $actualHours);
        }

        $booking->update($fields);
        $result = $this->findOrFail($id, $provider);
        $this->notify(new BookingDelivered($result));
        return $result;
    }

    /**
     * HOURLY_CAPPED final charge: max(actual, minimum) × rate, plus the
     * confirmed add-ons, never above the held amount.
     */
    private function hourlyCappedCharge(Booking $booking, float $actualHours): float
    {
        $service  = $booking->service;
        $rate     = (float) ($service->hourly_rate ?? 0);
        $billable = max($actualHours, (float) ($service->minimum_hours ?? 0));

        $addonTotal = 0.0;
        if (! empty($booking->selected_addon_ids)) {
            $addonTotal = (float) ServiceAddon::where('service_id', $service->id)
                ->whereIn('id', $booking->selected_addon_ids)
                ->sum('price');
        }

        $held = (float) ($booking->agreed_amount ?? $booking->amount);

        return round(min($billable * $rate + $addonTotal, $held), 2);
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
     * transaction-based payout, which stranded every PawaPay booking.)
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

        // HOURLY_CAPPED: settle on the actual charge computed at delivery.
        $finalGross   = $heldGross;
        $refundAmount = 0.0;
        if ($model === 'HOURLY_CAPPED' && $booking->actual_charge_zmw !== null) {
            $finalGross   = (float) $booking->actual_charge_zmw;
            $refundAmount = round(max($heldGross - $finalGross, 0), 2);
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
                $ok = $this->gateway->refund(
                    $booking->escrow_hold_ref,
                    $booking->buyer?->phone ?? '',
                    $refundAmount,
                );
                Log::info('BookingService: hourly-capped unused-cap refund ' . ($ok ? 'initiated' : 'FAILED'), [
                    'booking_id' => $booking->id, 'refund_zmw' => $refundAmount,
                ]);
            } catch (\Throwable $e) {
                Log::error('BookingService: hourly-capped refund failed — needs manual reconciliation', [
                    'booking_id' => $booking->id, 'refund_zmw' => $refundAmount, 'error' => $e->getMessage(),
                ]);
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
     * PawaPay callback (balance_hold_ref → escrow_phase FULL); the stub confirms
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
            Log::error('BookingService::collectBalance — balance collection failed, will retry', [
                'booking_id' => $booking->id, 'error' => $e->getMessage(),
            ]);
            return;
        }

        $booking->update([
            'balance_hold_ref' => $balanceRef,
            'escrow_phase'     => config('pawapay.enabled', false) ? 'BALANCE' : 'FULL',
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

        $amount = (float) ($booking->provider_split_zmw ?? $booking->amount);

        $payoutRef = $this->gateway->releaseFunds(
            $booking->escrow_hold_ref,
            $profile->momo_number,
            $amount,
            $booking->id,
        );

        if ($payoutRef !== null) {
            // Persist the payout reference BEFORE the async callback can arrive —
            // PawapayCallbackController::handlePayoutCallback looks the booking
            // up by this column, the same reliable pattern escrow_hold_ref uses
            // for deposits.
            $booking->update(['status' => 'DISBURSED', 'disbursed_at' => now(), 'payout_ref' => $payoutRef]);
            $this->notify(new \App\Events\PayoutReleased($booking));
        } else {
            Log::error('BookingService::disbursePayout — gateway release failed', ['booking_id' => $booking->id]);
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

        // Escrow cancellation — quote-first states (SCOPE_PENDING / QUOTE_SENT)
        // carry no funds; DEPOSIT_HELD refunds the deposit.
        if (! \in_array($booking->status, ['REQUESTED', 'QUOTED', 'SCOPE_PENDING', 'QUOTE_SENT', 'FUNDS_HELD', 'DEPOSIT_HELD'], true)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Booking can only be cancelled before it starts.');
        }

        DB::transaction(function () use ($booking) {
            if (\in_array($booking->status, ['FUNDS_HELD', 'DEPOSIT_HELD'], true) && $booking->escrow_hold_ref) {
                $buyerPhone = $booking->buyer->phone ?? '';
                $held       = $booking->status === 'DEPOSIT_HELD'
                    ? (float) $booking->deposit_amount
                    : (float) ($booking->agreed_amount ?? $booking->amount);
                $this->gateway->refund($booking->escrow_hold_ref, $buyerPhone, $held + (float) $booking->buyer_protection_fee);
            } elseif ($booking->status === 'FUNDS_HELD') {
                $this->payment->initiateRefund($booking);
            }
            $booking->update(['status' => 'CANCELLED']);
        });

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

        $booking->load(['service.category', 'buyer', 'provider.providerProfile', 'transactions', 'commission', 'dispute', 'review']);

        // Provider-facing, qualitative buyer trust hint (§10.2) + privacy-safe label.
        $booking->setAttribute('buyer_trust_hint', $this->trustHint($booking->buyer, $booking->provider_id));
        $booking->setAttribute('buyer_label',      $this->buyerLabel($booking->buyer));

        // Auto-confirm deadline while DELIVERED (DELIVERED→COMPLETED after autoconfirm_hours).
        $booking->setAttribute(
            'auto_release_at',
            $booking->status === 'DELIVERED' && $booking->updated_at
                ? $booking->updated_at->copy()->addHours((int) config('booking.autoconfirm_hours', 24))->toISOString()
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
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                "This action requires booking status '{$expected}' (current: {$booking->status}).",
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

        $isRepeat = Booking::where('buyer_id', $buyer->id)
            ->where('provider_id', $providerId)
            ->where('status', 'COMPLETED')
            ->exists();

        if ($isRepeat) return 'REPEAT_CLIENT';

        if ($buyer->risk_score !== null && (float) $buyer->risk_score <= 0.3) return 'TRUSTED';

        return 'NEW';
    }

    private function buyerLabel(?User $buyer): string
    {
        if (! $buyer) return 'Customer';
        if ($buyer->email) return ucfirst(explode('@', $buyer->email)[0]);
        return $buyer->phone ?? 'Customer';
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
