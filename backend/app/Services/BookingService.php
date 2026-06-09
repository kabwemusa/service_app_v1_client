<?php

namespace App\Services;

use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\ForbiddenException;
use App\Exceptions\Api\NotFoundException;
use App\Enums\ErrorCode;
use App\Enums\TrustTier;
use App\Models\Booking;
use App\Models\Commission;
use App\Models\Dispute;
use App\Models\ProviderProfile;
use App\Models\Service;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Manages the v3 booking lifecycle (§12):
 *
 *   create → AWAITING_KYC (if booking > cap but KYC pending)
 *          → PENDING_PAYMENT → FUNDS_HELD → IN_PROGRESS → DELIVERED → COMPLETED → DISBURSED
 *                                                                   ↘ DISPUTED
 *                              ↘ CANCELLED (buyer, before IN_PROGRESS)
 *                                         CHARGEBACK_PENDING (after COMPLETED/DISBURSED)
 */
class BookingService
{
    public function __construct(
        private readonly BookingConflictService  $conflict,
        private readonly PaymentService          $payment,
        private readonly CommissionService       $commission,
        private readonly InsuranceReserveService $reserve,
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

        // ── v3 Tier gates ────────────────────────────────────────────────────
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
                . "They need additional verification to accept this booking.",
            );
        }

        // Buyer protection fee (§8.3)
        $protectionFee = $this->commission->buyerProtectionFee($bookingAmount);

        // Conflict check
        $this->conflict->check(
            providerId:         $provider->id,
            scheduledStart:     $data['scheduled_start'],
            scheduledEnd:       $data['scheduled_end'],
            deliveryLat:        $data['delivery_lat'],
            deliveryLng:        $data['delivery_lng'],
            availabilityMatrix: $profile->availability_matrix ?? [],
        );

        $bookingId = DB::selectOne("
            INSERT INTO bookings
                (id, buyer_id, provider_id, service_id,
                 amount, buyer_protection_fee,
                 status, scheduled_start, scheduled_end,
                 delivery_location,
                 delivery_location_label, delivery_location_region, delivery_location_source,
                 created_at, updated_at)
            VALUES
                (gen_random_uuid(), ?, ?, ?,
                 ?, ?,
                 'PENDING_PAYMENT', ?::timestamptz, ?::timestamptz,
                 ST_GeogFromText('POINT(' || ? || ' ' || ? || ')'),
                 ?, ?, ?,
                 NOW(), NOW())
            RETURNING id
        ", [
            $buyer->id,
            $provider->id,
            $service->id,
            $bookingAmount,
            $protectionFee,
            $data['scheduled_start'],
            $data['scheduled_end'],
            $data['delivery_lng'],
            $data['delivery_lat'],
            $data['delivery_location_label'] ?? null,
            $data['delivery_location_region'] ?? null,
            $data['delivery_location_source'] ?? null,
        ])->id;

        return $this->findOrFail($bookingId, $buyer);
    }

    // ── List ─────────────────────────────────────────────────────────────────

    public function list(User $user): LengthAwarePaginator
    {
        return Booking::with(['service', 'buyer', 'provider'])
            ->where(function ($q) use ($user) {
                $q->where('buyer_id', $user->id)
                  ->orWhere('provider_id', $user->id);
            })
            ->selectRaw("
                bookings.*,
                ST_Y(delivery_location::geometry) AS delivery_lat,
                ST_X(delivery_location::geometry) AS delivery_lng
            ")
            ->latest()
            ->paginate(20);
    }

    /**
     * §6.8 — incoming requests grouped into "New" (escrow funded, not yet
     * started) and "Scheduled" (in progress), each with a derived buyer
     * trust hint (§8 — qualitative only, never the raw risk score) and a
     * live "you keep {net} of {gross}" commission preview (§8.2).
     */
    public function incomingRequests(User $provider): array
    {
        $profile = ProviderProfile::where('user_id', $provider->id)->first();
        $tier    = TrustTier::from($profile?->trust_tier ?? 0);

        $bookings = Booking::with(['service.category', 'buyer'])
            ->where('provider_id', $provider->id)
            ->whereIn('status', ['FUNDS_HELD', 'IN_PROGRESS'])
            ->selectRaw("
                bookings.*,
                ST_Y(delivery_location::geometry) AS delivery_lat,
                ST_X(delivery_location::geometry) AS delivery_lng
            ")
            ->orderBy('scheduled_start')
            ->get();

        $entries = $bookings->map(function (Booking $booking) use ($provider, $profile, $tier) {
            $gross   = (float) $booking->amount;
            $preview = $this->commission->calculate(
                gross:      $gross,
                categoryId: (int) ($booking->service->category_id ?? 0),
                tier:       $tier->value,
                providerId: $provider->id,
            );

            return [
                'booking_id'      => $booking->id,
                'status'          => $booking->status,
                'service_title'   => $booking->service?->title,
                'pricing_model'   => $booking->service?->pricing_model,
                'scheduled_start' => $booking->scheduled_start?->toIso8601String(),
                'scheduled_end'   => $booking->scheduled_end?->toIso8601String(),
                'delivery_label'  => $booking->delivery_location_label,
                'delivery_region' => $booking->delivery_location_region,
                'distance_km'     => $this->distanceKm($profile, $booking->delivery_lat, $booking->delivery_lng),
                'gross_zmw'       => round($gross, 2),
                'net_zmw'         => round($preview['net_to_provider'], 2),
                'commission_rate' => $preview['effective_rate'],
                'escrow_label'    => $booking->status === 'FUNDS_HELD'
                    ? 'Funds held in escrow — released when the job is marked complete'
                    : 'In progress — escrow releases on completion',
                'buyer_label'     => $this->buyerLabel($booking->buyer),
                'trust_hint'      => $this->trustHint($booking->buyer, $provider->id),
                'created_at'      => $booking->created_at?->toIso8601String(),
            ];
        });

        $thisWeekNet = (float) Commission::where('provider_id', $provider->id)
            ->where('calculated_at', '>=', now()->subDays(7))
            ->sum('net_to_provider');

        return [
            'weekly' => [
                'this_week_zmw'  => round($thisWeekNet, 2),
                'weekly_cap_zmw' => $tier->weeklyCapZmw(),
            ],
            'response_nudge' => [
                'response_rate_7d' => $profile?->response_rate_7d !== null ? (float) $profile->response_rate_7d : null,
                'show'             => ($profile?->response_rate_7d ?? 1.0) < 0.8,
            ],
            'new'       => $entries->where('status', 'FUNDS_HELD')->values()->all(),
            'scheduled' => $entries->where('status', 'IN_PROGRESS')->values()->all(),
        ];
    }

    /** §8 — qualitative buyer trust hint; never expose the raw risk score. */
    private function trustHint(?User $buyer, string $providerId): string
    {
        if (! $buyer) {
            return 'NEW';
        }

        $isRepeatClient = Booking::where('buyer_id', $buyer->id)
            ->where('provider_id', $providerId)
            ->where('status', 'COMPLETED')
            ->exists();

        if ($isRepeatClient) {
            return 'REPEAT_CLIENT';
        }

        if ($buyer->risk_score !== null && (float) $buyer->risk_score <= 0.3) {
            return 'TRUSTED';
        }

        return 'NEW';
    }

    /** A short, non-PII label for the request card — first part of the email/phone on file. */
    private function buyerLabel(?User $buyer): string
    {
        if (! $buyer) {
            return 'Customer';
        }

        if ($buyer->email) {
            return ucfirst(explode('@', $buyer->email)[0]);
        }

        return $buyer->phone ?? 'Customer';
    }

    private function distanceKm(?ProviderProfile $profile, ?float $lat, ?float $lng): ?float
    {
        if (! $profile || $profile->base_location_lat === null || $profile->base_location_lng === null
            || $lat === null || $lng === null) {
            return null;
        }

        $earthRadiusKm = 6371.0;
        $dLat = deg2rad($lat - $profile->base_location_lat);
        $dLng = deg2rad($lng - $profile->base_location_lng);
        $a    = sin($dLat / 2) ** 2
            + cos(deg2rad($profile->base_location_lat)) * cos(deg2rad($lat)) * sin($dLng / 2) ** 2;

        return round($earthRadiusKm * 2 * atan2(sqrt($a), sqrt(1 - $a)), 1);
    }

    public function findOrFail(string $id, User $user): Booking
    {
        $rows = DB::select("
            SELECT
                bookings.*,
                ST_Y(delivery_location::geometry) AS delivery_lat,
                ST_X(delivery_location::geometry) AS delivery_lng
            FROM bookings
            WHERE id = ?
            LIMIT 1
        ", [$id]);

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

        return $booking->load(['service', 'buyer', 'provider', 'transactions', 'commission', 'dispute']);
    }

    // ── Status Transitions ───────────────────────────────────────────────────

    public function confirmPayment(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $this->requireStatus($booking, 'PENDING_PAYMENT');
        $this->payment->initiatePayIn($booking);
        return $this->findOrFail($id, $buyer);
    }

    public function markInProgress(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->requireStatus($booking, 'FUNDS_HELD');
        $booking->update(['status' => 'IN_PROGRESS']);
        return $this->findOrFail($id, $provider);
    }

    public function markDelivered(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');
        $this->requireStatus($booking, 'IN_PROGRESS');
        $booking->update(['status' => 'DELIVERED']);
        return $this->findOrFail($id, $provider);
    }

    /**
     * Buyer confirms delivery — DELIVERED → COMPLETED.
     * Records commission, sets tiered payout hold, initiates payout
     * only if the hold has already expired (e.g. Tier 4 with instant payout).
     */
    public function complete(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');
        $this->requireStatus($booking, 'DELIVERED');

        $booking->load(['service.category', 'provider.providerProfile']);

        $tier          = (int) ($booking->provider->providerProfile->trust_tier ?? 1);
        $holdHours     = TrustTier::from($tier)->payoutHoldHours();
        $eligibleAt    = now()->addHours($holdHours);

        DB::transaction(function () use ($booking, $eligibleAt) {
            $booking->update([
                'status'             => 'COMPLETED',
                'completed_at'       => now(),
                'payout_eligible_at' => $eligibleAt,
            ]);

            // Write commission ledger row
            $this->commission->record($booking);

            // Credit the buyer protection fee into the insurance reserve (§11.5)
            if ($booking->buyer_protection_fee > 0) {
                $this->reserve->credit($booking);
            }
        });

        // If hold is 0 (shouldn't happen but defensive), payout immediately
        if ($eligibleAt->isPast()) {
            $this->payment->initiatePayout($booking->fresh()->load('service', 'provider'));
        }

        return $this->findOrFail($id, $buyer);
    }

    /**
     * Provider requests instant payout — waives hold for 1% fee (§8.6).
     * Marks the flag; the payout batch worker processes it immediately.
     */
    public function requestInstantPayout(string $id, User $provider): Booking
    {
        $booking = $this->loadAndAuthorize($id, $provider, 'provider_id');

        if ($booking->status !== 'COMPLETED') {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Instant payout is only available for COMPLETED bookings.');
        }

        $profile = ProviderProfile::where('user_id', $provider->id)->firstOrFail();
        $tier    = TrustTier::from($profile->trust_tier);

        if (! $tier->hasInstantPayout()) {
            throw new ApiException(ErrorCode::TIER_EXCEEDED, 'Instant payout requires Tier 3 or higher.');
        }

        $booking->update([
            'instant_payout_requested' => true,
            'payout_eligible_at'       => now(),   // eligible immediately
        ]);

        // Trigger payout right away (1% instant payout fee applied in PaymentService)
        $this->payment->initiatePayout($booking->fresh()->load('service', 'provider'), instantPayout: true);

        return $this->findOrFail($id, $provider);
    }

    /**
     * Buyer cancels — allowed before IN_PROGRESS.
     * Issues a refund if funds were already held.
     */
    public function cancel(string $id, User $buyer): Booking
    {
        $booking = $this->loadAndAuthorize($id, $buyer, 'buyer_id');

        if (! in_array($booking->status, ['PENDING_PAYMENT', 'FUNDS_HELD'])) {
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
     * Initiate chargeback state — COMPLETED/DISBURSED → CHARGEBACK_PENDING.
     * Called by a payment webhook handler when a card network initiates a chargeback.
     */
    public function initiateChargeback(string $bookingId): Booking
    {
        $booking = Booking::findOrFail($bookingId);

        if (! in_array($booking->status, ['COMPLETED', 'DISBURSED'])) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Chargeback can only be initiated on COMPLETED or DISBURSED bookings.');
        }

        DB::transaction(function () use ($booking) {
            $booking->update(['status' => 'CHARGEBACK_PENDING']);

            // Freeze any pending payout
            Transaction::where('booking_id', $booking->id)
                ->where('type', 'PAY_OUT')
                ->where('status', 'PENDING')
                ->update(['status' => 'FROZEN']);

            Log::warning('BookingService: chargeback initiated', ['booking_id' => $booking->id]);
        });

        // Auto-open a dispute record
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

    // ── Payout Batch (called by the scheduled payout worker) ─────────────────

    /**
     * Process all COMPLETED bookings whose payout hold has expired.
     */
    public function processDuePayouts(): array
    {
        $due = Booking::where('status', 'COMPLETED')
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

    // ── Helpers ──────────────────────────────────────────────────────────────

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
}
