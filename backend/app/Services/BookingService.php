<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Enums\TrustTier;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\ForbiddenException;
use App\Exceptions\Api\NotFoundException;
use App\Models\Booking;
use App\Models\Commission;
use App\Models\Dispute;
use App\Models\ProviderProfile;
use App\Models\Review;
use App\Models\Service;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ranking\PersonalizationService;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Manages the unified booking lifecycle.
 *
 * DIRECT mode (default — config('booking.payment_mode')):
 *   create → REQUESTED → ACCEPTED → IN_PROGRESS → DELIVERED → COMPLETED
 *          ↗ QUOTED (provider proposes alternate price) → ACCEPTED
 *          ↘ DECLINED / EXPIRED / CANCELLED / NO_SHOW / DISPUTED
 *   No MoMo calls, no fund custody. Commission ledger = UNCOLLECTED (shadow revenue).
 *
 * ESCROW mode (dormant — activate via PAYMENT_MODE=ESCROW):
 *   create → PENDING_PAYMENT → FUNDS_HELD → IN_PROGRESS → DELIVERED → COMPLETED → DISBURSED
 *          ↘ AWAITING_KYC / CANCELLED / DISPUTED / CHARGEBACK_PENDING
 */
class BookingService
{
    public function __construct(
        private readonly BookingConflictService  $conflict,
        private readonly PaymentService          $payment,
        private readonly CommissionService       $commission,
        private readonly InsuranceReserveService $reserve,
        private readonly PersonalizationService  $personalization,
        private readonly BookingStateMachine     $machine,
    ) {}

    // ── Create ───────────────────────────────────────────────────────────────

    public function create(User $buyer, array $data): Booking
    {
        $service = Service::find($data['service_id']);
        if (! $service || ! $service->isActive()) {
            throw new NotFoundException('Service');
        }

        $provider = User::find($service->provider_id);
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

        $bookingAmount = (float) $service->base_price;
        $tier          = TrustTier::from($profile->trust_tier);
        $cap           = $tier->jobCapZmw();

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

        $mode = config('booking.payment_mode', 'DIRECT');

        if ($mode === 'DIRECT') {
            return $this->createDirect($buyer, $provider, $service, $data, $bookingAmount);
        }

        return $this->createEscrow($buyer, $provider, $service, $data, $bookingAmount);
    }

    private function createDirect(User $buyer, User $provider, Service $service, array $data, float $amount): Booking
    {
        $expiresAt = now()->addHours(config('booking.response_window_hours', 24));

        $id = DB::selectOne("
            INSERT INTO bookings
                (id, buyer_id, provider_id, service_id,
                 amount, buyer_protection_fee,
                 payment_mode, status, expires_at,
                 scheduled_start, scheduled_end,
                 delivery_location,
                 delivery_location_label, delivery_location_region, delivery_location_source,
                 created_at, updated_at)
            VALUES
                (gen_random_uuid(), ?, ?, ?,
                 ?, 0,
                 'DIRECT', 'REQUESTED', ?::timestamptz,
                 ?::timestamptz, ?::timestamptz,
                 ST_GeogFromText('POINT(' || ? || ' ' || ? || ')'),
                 ?, ?, ?,
                 NOW(), NOW())
            RETURNING id
        ", [
            $buyer->id, $provider->id, $service->id,
            $amount,
            $expiresAt->toIso8601String(),
            $data['scheduled_start'],
            $data['scheduled_end'],
            $data['delivery_lng'],
            $data['delivery_lat'],
            $data['delivery_location_label']  ?? null,
            $data['delivery_location_region'] ?? null,
            $data['delivery_location_source'] ?? null,
        ])->id;

        return $this->findOrFail($id, $buyer);
    }

    private function createEscrow(User $buyer, User $provider, Service $service, array $data, float $amount): Booking
    {
        $protectionFee = $this->commission->buyerProtectionFee($amount, $buyer->id, $provider->id);

        $id = DB::selectOne("
            INSERT INTO bookings
                (id, buyer_id, provider_id, service_id,
                 amount, buyer_protection_fee,
                 payment_mode, status,
                 scheduled_start, scheduled_end,
                 delivery_location,
                 delivery_location_label, delivery_location_region, delivery_location_source,
                 created_at, updated_at)
            VALUES
                (gen_random_uuid(), ?, ?, ?,
                 ?, ?,
                 'ESCROW', 'PENDING_PAYMENT',
                 ?::timestamptz, ?::timestamptz,
                 ST_GeogFromText('POINT(' || ? || ' ' || ? || ')'),
                 ?, ?, ?,
                 NOW(), NOW())
            RETURNING id
        ", [
            $buyer->id, $provider->id, $service->id,
            $amount, $protectionFee,
            $data['scheduled_start'],
            $data['scheduled_end'],
            $data['delivery_lng'],
            $data['delivery_lat'],
            $data['delivery_location_label']  ?? null,
            $data['delivery_location_region'] ?? null,
            $data['delivery_location_source'] ?? null,
        ])->id;

        return $this->findOrFail($id, $buyer);
    }

    // ── List ─────────────────────────────────────────────────────────────────

    public function list(User $user): LengthAwarePaginator
    {
        return Booking::with(['service', 'buyer', 'provider', 'review'])
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
     * DIRECT:  groups REQUESTED+QUOTED as "new" (need response),
     *          ACCEPTED+IN_PROGRESS as "scheduled" (committed work).
     * ESCROW:  groups FUNDS_HELD as "new", IN_PROGRESS as "scheduled".
     */
    public function incomingRequests(User $provider): array
    {
        $profile = ProviderProfile::where('user_id', $provider->id)->first();
        $tier    = TrustTier::from($profile?->trust_tier ?? 0);

        $mode = config('booking.payment_mode', 'DIRECT');

        $activeStatuses = $mode === 'DIRECT'
            ? ['REQUESTED', 'QUOTED', 'ACCEPTED', 'IN_PROGRESS']
            : ['FUNDS_HELD', 'IN_PROGRESS'];

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

        $entries = $bookings->map(function (Booking $booking) use ($provider, $profile, $tier, $mode) {
            $gross = (float) ($booking->agreed_amount ?? $booking->amount);

            if ($mode === 'DIRECT') {
                // In DIRECT, provider keeps the full agreed amount; show shadow commission rate.
                $preview = $this->commission->calculate(
                    gross:      $gross,
                    categoryId: (int) ($booking->service->category_id ?? 0),
                    tier:       $tier->value,
                    providerId: $provider->id,
                    buyerId:    $booking->buyer_id,
                );

                $statusLabel = match ($booking->status) {
                    'REQUESTED' => 'New request — accept or decline',
                    'QUOTED'    => 'Quote sent — awaiting buyer',
                    'ACCEPTED'  => 'Accepted — start when ready',
                    default     => 'In progress',
                };
            } else {
                $preview = $this->commission->calculate(
                    gross:      $gross,
                    categoryId: (int) ($booking->service->category_id ?? 0),
                    tier:       $tier->value,
                    providerId: $provider->id,
                    buyerId:    $booking->buyer_id,
                );

                $statusLabel = $booking->status === 'FUNDS_HELD'
                    ? 'Funds held in escrow — released when the job is marked complete'
                    : 'In progress — escrow releases on completion';
            }

            return [
                'booking_id'      => $booking->id,
                'payment_mode'    => $booking->payment_mode ?? $mode,
                'status'          => $booking->status,
                'service_title'   => $booking->service?->title,
                'pricing_model'   => $booking->service?->pricing_model,
                'scheduled_start' => $booking->scheduled_start?->toIso8601String(),
                'scheduled_end'   => $booking->scheduled_end?->toIso8601String(),
                'delivery_label'  => $booking->delivery_location_label,
                'delivery_region' => $booking->delivery_location_region,
                'distance_km'     => $this->distanceKm($profile, $booking->delivery_lat, $booking->delivery_lng),
                'gross_zmw'       => round($gross, 2),
                'net_zmw'         => $mode === 'DIRECT' ? round($gross, 2) : round($preview['net_to_provider'], 2),
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

        if ($mode === 'DIRECT') {
            $new       = $entries->whereIn('status', ['REQUESTED', 'QUOTED'])->values()->all();
            $scheduled = $entries->whereIn('status', ['ACCEPTED', 'IN_PROGRESS'])->values()->all();
        } else {
            $new       = $entries->where('status', 'FUNDS_HELD')->values()->all();
            $scheduled = $entries->where('status', 'IN_PROGRESS')->values()->all();
        }

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

    // ── DIRECT mode transitions ───────────────────────────────────────────────

    /**
     * Provider accepts a REQUESTED booking at the listed price.
     */
    public function accept(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->requireDirectMode($booking);
        $this->machine->assertTransition($booking, 'ACCEPTED');

        $booking->update([
            'status'       => 'ACCEPTED',
            'agreed_amount' => $booking->agreed_amount ?? $booking->amount,
        ]);

        return $this->findOrFail($id, $provider);
    }

    /**
     * Provider sends an alternate-price quote — REQUESTED → QUOTED.
     * The proposed price is stored in agreed_amount. Buyer calls acceptQuote()
     * to confirm, or cancel() to decline.
     */
    public function quote(string $id, User $provider, float $proposedAmount): Booking
    {
        if ($proposedAmount <= 0) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Quote amount must be greater than zero.');
        }

        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->requireDirectMode($booking);
        $this->machine->assertTransition($booking, 'QUOTED');

        $booking->update([
            'status'       => 'QUOTED',
            'agreed_amount' => $proposedAmount,
        ]);

        return $this->findOrFail($id, $provider);
    }

    /**
     * Buyer accepts a provider's quote — QUOTED → ACCEPTED.
     */
    public function acceptQuote(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $this->requireDirectMode($booking);
        $this->machine->assertTransition($booking, 'ACCEPTED');

        $booking->update(['status' => 'ACCEPTED']);

        return $this->findOrFail($id, $buyer);
    }

    /**
     * Provider declines a REQUESTED booking — REQUESTED → DECLINED.
     */
    public function decline(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->requireDirectMode($booking);
        $this->machine->assertTransition($booking, 'DECLINED');

        $booking->update(['status' => 'DECLINED']);

        return $this->findOrFail($id, $provider);
    }

    /**
     * Record that direct payment was made/received (DIRECT mode only).
     * Both buyer and provider may call this; it is purely informational.
     */
    public function markPaid(string $id, User $user): Booking
    {
        $booking = Booking::find($id);
        if (! $booking) throw new NotFoundException('Booking');

        if ($booking->buyer_id !== $user->id && $booking->provider_id !== $user->id) {
            throw new ForbiddenException('You are not party to this booking.');
        }

        $this->requireDirectMode($booking);

        if (\in_array($booking->status, ['CANCELLED', 'DECLINED', 'EXPIRED'], true)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Cannot record payment for a closed booking.');
        }

        $booking->update([
            'payment_status'    => 'MARKED_PAID',
            'payment_marked_by' => $user->id,
            'payment_marked_at' => now(),
        ]);

        return $this->findOrFail($id, $user);
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

    // ── ESCROW-only transition ────────────────────────────────────────────────

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
        return $this->findOrFail($id, $provider);
    }

    /**
     * Provider marks job delivered — IN_PROGRESS → DELIVERED (both modes).
     */
    public function markDelivered(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->machine->assertTransition($booking, 'DELIVERED');
        $booking->update(['status' => 'DELIVERED']);
        return $this->findOrFail($id, $provider);
    }

    /**
     * Buyer confirms delivery — DELIVERED → COMPLETED.
     *
     * DIRECT: records UNCOLLECTED commission; no payout call.
     * ESCROW: records COLLECTED commission; initiates payout hold.
     */
    public function complete(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $this->machine->assertTransition($booking, 'COMPLETED');

        $booking->load(['service.category', 'provider.providerProfile']);

        $mode = $booking->payment_mode ?? 'ESCROW';

        if ($mode === 'DIRECT') {
            DB::transaction(function () use ($booking) {
                $booking->update([
                    'status'       => 'COMPLETED',
                    'completed_at' => now(),
                ]);
                $this->commission->record($booking, 'DIRECT', 'UNCOLLECTED');
            });

            $this->personalization->invalidate($booking->buyer_id);
            return $this->findOrFail($id, $buyer);
        }

        // ESCROW: payout hold logic
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

        if ($eligibleAt->isPast()) {
            $this->payment->initiatePayout($booking->fresh()->load('service', 'provider'));
        }

        return $this->findOrFail($id, $buyer);
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

        Review::create([
            'booking_id'  => $booking->id,
            'reviewer_id' => $buyer->id,
            'reviewee_id' => $booking->provider_id,
            'rating'      => $rating,
            'comment'     => $comment !== null && trim($comment) !== '' ? trim($comment) : null,
        ]);

        $this->personalization->invalidate($buyer->id);

        return $this->findOrFail($id, $buyer);
    }

    /**
     * Provider requests instant payout — ESCROW only (Tier 3+, waives hold for 1% fee).
     */
    public function requestInstantPayout(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');

        if ($booking->status !== 'COMPLETED') {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Instant payout is only available for COMPLETED bookings.');
        }

        if (($booking->payment_mode ?? 'ESCROW') === 'DIRECT') {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Instant payout is not available in DIRECT mode.');
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

        $this->payment->initiatePayout($booking->fresh()->load('service', 'provider'), instantPayout: true);

        return $this->findOrFail($id, $provider);
    }

    /**
     * Buyer cancels.
     *
     * DIRECT: allowed from REQUESTED / QUOTED / ACCEPTED; no refund.
     * ESCROW: allowed from PENDING_PAYMENT / FUNDS_HELD; refunds if funds held.
     */
    public function cancel(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');

        $mode = $booking->payment_mode ?? 'ESCROW';

        if ($mode === 'DIRECT') {
            if (! \in_array($booking->status, ['REQUESTED', 'QUOTED', 'ACCEPTED'], true)) {
                throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Booking can only be cancelled before the provider starts work.');
            }
            $booking->update(['status' => 'CANCELLED']);
            return $this->findOrFail($id, $buyer);
        }

        // ESCROW
        if (! \in_array($booking->status, ['PENDING_PAYMENT', 'FUNDS_HELD'], true)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Booking can only be cancelled before it starts.');
        }

        DB::transaction(function () use ($booking) {
            if ($booking->status === 'FUNDS_HELD') {
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
     * Process COMPLETED ESCROW bookings whose payout hold has expired.
     * DIRECT bookings are skipped — there is no platform payout in DIRECT mode.
     */
    public function processDuePayouts(): array
    {
        $due = Booking::where('status', 'COMPLETED')
            ->where('payment_mode', 'ESCROW')
            ->where('payout_eligible_at', '<=', now())
            ->whereNull('disbursed_at')
            ->with(['service', 'provider'])
            ->get();

        $succeeded = 0;
        $failed    = 0;

        foreach ($due as $booking) {
            try {
                $this->payment->initiatePayout($booking);
                $booking->update(['status' => 'DISBURSED', 'disbursed_at' => now()]);
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

        return $booking->load(['service', 'buyer', 'provider', 'transactions', 'commission', 'dispute', 'review']);
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

    private function requireDirectMode(Booking $booking): void
    {
        if (($booking->payment_mode ?? 'ESCROW') !== 'DIRECT') {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'This action is only available for DIRECT mode bookings.',
            );
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
