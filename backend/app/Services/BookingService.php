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

        // Compute the correct booking amount based on pricing model + add-ons.
        $basePrice = (float) $service->base_price;

        if ($service->pricing_model === 'HOURLY') {
            $start    = new \DateTime($data['scheduled_start']);
            $end      = new \DateTime($data['scheduled_end']);
            $diffSecs = $end->getTimestamp() - $start->getTimestamp();
            $hours    = max($diffSecs / 3600, 0);
            $serviceCost = $basePrice * $hours;
        } else {
            $serviceCost = $basePrice;
        }

        $addonTotal = 0.0;
        $addonIds   = $data['addon_ids'] ?? [];
        if (! empty($addonIds)) {
            $addonTotal = (float) ServiceAddon::where('service_id', $service->id)
                ->whereIn('id', $addonIds)
                ->sum('price');
        }

        $bookingAmount = round($serviceCost + $addonTotal, 2);

        $tier = TrustTier::from($profile->trust_tier);
        $cap  = $tier->jobCapZmw();

        if ($cap !== null && $bookingAmount > $cap) {
            throw new ApiException(
                ErrorCode::TIER_EXCEEDED,
                "This provider's current tier limits bookings to ZMW {$cap}. "
                . 'They need additional verification to accept this booking.',
            );
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

    private function createEscrowBooking(
        User $buyer, User $provider, Service $service, array $data, float $amount, string $channel,
    ): Booking {
        $protectionFee = $this->commission->buyerProtectionFee($amount, $buyer->id, $provider->id);
        $addonIds      = ! empty($data['addon_ids']) ? json_encode(array_map('intval', $data['addon_ids'])) : null;
        $notes         = isset($data['notes']) && trim($data['notes']) !== '' ? trim($data['notes']) : null;
        $expiresAt     = now()->addHours(config('booking.response_window_hours', 24));

        // Pre-compute the commission split for escrow
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
                     notes, selected_addon_ids,
                     created_at, updated_at)
                VALUES
                    (gen_random_uuid(), ?, ?, ?,
                     ?, ?,
                     'ESCROW', 'REQUESTED', ?::timestamptz,
                     ?, ?,
                     ?,
                     ?::timestamptz, ?::timestamptz,
                     ST_GeogFromText('POINT(' || ? || ' ' || ? || ')'),
                     ?, ?, ?,
                     ?, ?::jsonb,
                     NOW(), NOW())
                RETURNING id
            ", [
                $buyer->id, $provider->id, $service->id,
                $amount, $protectionFee,
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

        $activeStatuses = ['REQUESTED', 'QUOTED', 'ACCEPTED', 'FUNDS_HELD', 'IN_PROGRESS'];

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
                'REQUESTED'   => 'New request — respond or decline',
                'QUOTED'      => 'Quote sent — awaiting customer',
                'ACCEPTED'    => 'Accepted — start when ready',
                'FUNDS_HELD'  => 'Funds held in escrow — start when ready',
                'IN_PROGRESS' => 'In progress',
                default       => $booking->status,
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

        $new       = $entries->whereIn('status', ['REQUESTED', 'QUOTED'])->values()->all();
        $scheduled = $entries->whereIn('status', ['ACCEPTED', 'FUNDS_HELD', 'IN_PROGRESS'])->values()->all();

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
     * Provider sends an alternate-price quote — REQUESTED → QUOTED.
     */
    public function quote(string $id, User $provider, float $proposedAmount, ?string $message = null): Booking
    {
        if ($proposedAmount <= 0) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Quote amount must be greater than zero.');
        }

        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->machine->assertTransition($booking, 'QUOTED');

        $booking->update([
            'status'         => 'QUOTED',
            'quoted_amount'  => $proposedAmount,
            'agreed_amount'  => $proposedAmount,
            'quote_message'  => $message,
        ]);

        $result = $this->findOrFail($id, $provider);
        $this->notify(new BookingQuoted($result));
        return $result;
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
     * Buyer confirms and holds funds — REQUESTED/QUOTED → FUNDS_HELD.
     * This is the escrow payment step: customer pays via gateway, funds held.
     */
    public function holdFunds(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $booking->load(['buyer', 'service', 'provider.providerProfile']);

        $buyerPhone = $booking->buyer->phone
            ?? throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Your account has no phone number on file.');

        $amount          = (float) ($booking->agreed_amount ?? $booking->amount);
        $commissionSplit = (float) ($booking->commission_split_zmw ?? 0);
        $providerSplit   = (float) ($booking->provider_split_zmw ?? $amount - $commissionSplit);

        $isAsync = config('pawapay.enabled', false);

        if ($isAsync) {
            $this->machine->assertTransition($booking, 'PENDING_PAYMENT');
        } else {
            $this->machine->assertTransition($booking, 'FUNDS_HELD');
        }

        $holdRef = $this->gateway->holdFunds(
            $buyerPhone, $amount + (float) $booking->buyer_protection_fee,
            $booking->id, $commissionSplit, $providerSplit,
        );

        if ($isAsync) {
            // PawaPay: deposit initiated, MoMo prompt sent to customer.
            // Callback will advance to FUNDS_HELD when customer confirms.
            $booking->update([
                'status'          => 'PENDING_PAYMENT',
                'escrow_hold_ref' => $holdRef,
                'agreed_amount'   => $amount,
            ]);
        } else {
            // Stub: instant success.
            $booking->update([
                'status'          => 'FUNDS_HELD',
                'escrow_hold_ref' => $holdRef,
                'agreed_amount'   => $amount,
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
     */
    public function markDelivered(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->machine->assertTransition($booking, 'DELIVERED');
        $booking->update(['status' => 'DELIVERED']);
        $result = $this->findOrFail($id, $provider);
        $this->notify(new BookingDelivered($result));
        return $result;
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
        $this->machine->assertTransition($booking, 'COMPLETED');

        $booking->load(['service.category', 'provider.providerProfile']);

        if ($this->machine->isLegacyDirect($booking)) {
            DB::transaction(function () use ($booking) {
                $booking->update([
                    'status'       => 'COMPLETED',
                    'completed_at' => now(),
                ]);
                $this->commission->record($booking, 'DIRECT', 'UNCOLLECTED');
            });

            $this->personalization->invalidate($booking->buyer_id);
            $result = $this->findOrFail($id, $buyer);
            $this->notify(new BookingCompleted($result));
            return $result;
        }

        // Escrow: payout hold logic
        $tier       = (int) ($booking->provider->providerProfile->trust_tier ?? 1);
        $holdHours  = TrustTier::from($tier)->payoutHoldHours();
        $eligibleAt = now()->addHours($holdHours);

        DB::transaction(function () use ($booking, $eligibleAt) {
            $booking->update([
                'status'             => 'COMPLETED',
                'completed_at'       => now(),
                'payout_eligible_at' => $eligibleAt,
            ]);
            $this->commission->record($booking, 'ESCROW', 'COLLECTED');

            if ($booking->buyer_protection_fee > 0) {
                $this->reserve->credit($booking);
            }
        });

        $this->personalization->invalidate($booking->buyer_id);
        $this->notify(new BookingCompleted($booking));

        if ($eligibleAt->isPast()) {
            $this->disbursePayout($booking->fresh()->load('service', 'provider'));
        }

        return $this->findOrFail($id, $buyer);
    }

    /**
     * Release escrow funds to the provider via the PaymentGateway.
     */
    private function disbursePayout(Booking $booking): void
    {
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

        $success = $this->gateway->releaseFunds(
            $booking->escrow_hold_ref,
            $profile->momo_number,
            $amount,
            $booking->id,
        );

        if ($success) {
            $booking->update(['status' => 'DISBURSED', 'disbursed_at' => now()]);
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

        // Escrow cancellation
        if (! \in_array($booking->status, ['REQUESTED', 'QUOTED', 'FUNDS_HELD'], true)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Booking can only be cancelled before it starts.');
        }

        DB::transaction(function () use ($booking) {
            if ($booking->status === 'FUNDS_HELD' && $booking->escrow_hold_ref) {
                $buyerPhone = $booking->buyer->phone ?? '';
                $amount     = (float) $booking->amount + (float) $booking->buyer_protection_fee;
                $this->gateway->refund($booking->escrow_hold_ref, $buyerPhone, $amount);
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
