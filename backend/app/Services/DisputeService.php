<?php

namespace App\Services;

use App\Enums\DisputeStatus;
use App\Enums\ErrorCode;
use App\Enums\UserRole;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\ForbiddenException;
use App\Exceptions\Api\NotFoundException;
use App\Models\Booking;
use App\Models\Commission;
use App\Models\Dispute;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Graded dispute resolution — §11.2
 *
 * Outcomes:
 *   RESOLVED_BUYER    — full refund, provider gets 0
 *   RESOLVED_PROVIDER — no refund,   provider gets full payout
 *   RESOLVED_PARTIAL  — partial refund, commission recalculated on retained amount
 *   WITHDRAWN         — buyer drops it, provider gets full payout
 */
class DisputeService
{
    public function __construct(
        private readonly PaymentService          $payment,
        private readonly CommissionService       $commission,
        private readonly InsuranceReserveService $reserve,
    ) {}

    /**
     * Buyer opens a dispute — DELIVERED → DISPUTED.
     * Creates a Dispute record with optional evidence keys.
     */
    public function open(Booking $booking, User $buyer, array $data): Dispute
    {
        if ($booking->buyer_id !== $buyer->id) {
            throw new ForbiddenException('Only the buyer can open a dispute.');
        }

        if ($booking->status !== 'DELIVERED') {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                "Disputes can only be opened on DELIVERED bookings (current: {$booking->status}).",
            );
        }

        return DB::transaction(function () use ($booking, $buyer, $data) {
            $dispute = Dispute::create([
                'booking_id'      => $booking->id,
                'raised_by'       => $buyer->id,
                'against'         => $booking->provider_id,
                'reason_category' => $data['reason_category'],
                'description'     => $data['description'],
                'evidence'        => $data['evidence'] ?? [],
                'status'          => DisputeStatus::OPEN->value,
                'opened_at'       => now(),
            ]);

            $booking->update(['status' => 'DISPUTED']);

            return $dispute;
        });
    }

    /**
     * Admin/moderator resolves a dispute with a graded outcome.
     *
     * @param  array{
     *   outcome:       string,
     *   refund_amount: float|null,
     *   notes:         string,
     * } $data
     */
    public function resolve(string $disputeId, User $resolver, array $data): Dispute
    {
        if (! UserRole::from($resolver->role)->canResolveDisputes()) {
            throw new ForbiddenException('Only admin or moderator can resolve disputes.');
        }

        $dispute = Dispute::find($disputeId);
        if (! $dispute) {
            throw new NotFoundException('Dispute');
        }

        if (! DisputeStatus::from($dispute->status)->isOpen()) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'This dispute is already resolved.');
        }

        $booking = Booking::with(['service', 'provider.providerProfile'])->find($dispute->booking_id);
        if (! $booking) {
            throw new NotFoundException('Booking');
        }

        $outcome      = $data['outcome'];
        $refundAmount = isset($data['refund_amount']) ? (float) $data['refund_amount'] : null;

        DB::transaction(function () use ($dispute, $booking, $resolver, $outcome, $refundAmount, $data) {
            match($outcome) {
                'RESOLVED_BUYER'    => $this->resolveBuyer($booking),
                'RESOLVED_PROVIDER' => $this->resolveProvider($booking),
                'RESOLVED_PARTIAL'  => $this->resolvePartial($booking, $refundAmount ?? 0.0),
                'WITHDRAWN'         => $this->resolveProvider($booking),
                default             => throw new ApiException(ErrorCode::VALIDATION_ERROR, "Unknown outcome: {$outcome}"),
            };

            $dispute->update([
                'status'           => $outcome,
                'refund_amount'    => in_array($outcome, ['RESOLVED_BUYER', 'RESOLVED_PARTIAL'])
                                        ? ($outcome === 'RESOLVED_BUYER' ? $booking->amount : $refundAmount)
                                        : null,
                'resolution_notes' => $data['notes'] ?? null,
                'resolved_by'      => $resolver->id,
                'resolved_at'      => now(),
            ]);
        });

        return $dispute->fresh();
    }

    /**
     * Buyer withdraws their own dispute — transitions to WITHDRAWN.
     */
    public function withdraw(string $disputeId, User $buyer): Dispute
    {
        $dispute = Dispute::find($disputeId);
        if (! $dispute) throw new NotFoundException('Dispute');

        if ($dispute->raised_by !== $buyer->id) {
            throw new ForbiddenException('Only the buyer who raised this dispute can withdraw it.');
        }

        if (! DisputeStatus::from($dispute->status)->isOpen()) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'This dispute is already resolved.');
        }

        $booking = Booking::with(['service', 'provider.providerProfile'])->find($dispute->booking_id);

        DB::transaction(function () use ($dispute, $booking) {
            $this->resolveProvider($booking);
            $dispute->update([
                'status'      => DisputeStatus::WITHDRAWN->value,
                'resolved_at' => now(),
            ]);
        });

        return $dispute->fresh();
    }

    // ── Resolution helpers ───────────────────────────────────────────────────

    private function resolveBuyer(Booking $booking): void
    {
        $this->payment->initiateRefund($booking);
        $booking->update(['status' => 'CANCELLED']);

        // Reverse any commission recorded
        Commission::where('booking_id', $booking->id)->delete();

        // Draw from insurance reserve to cover the refund (§11.5)
        $dispute = Dispute::where('booking_id', $booking->id)->first();
        if ($dispute && $booking->buyer_protection_fee > 0) {
            $this->reserve->claim(
                $dispute,
                (float) $booking->amount,
                "Full refund — RESOLVED_BUYER on booking {$booking->id}",
            );
        }
    }

    private function resolveProvider(Booking $booking): void
    {
        // Move booking to COMPLETED so the payout worker picks it up
        $booking->update([
            'status'       => 'COMPLETED',
            'completed_at' => $booking->completed_at ?? now(),
        ]);

        $this->payment->initiatePayout($booking);
    }

    private function resolvePartial(Booking $booking, float $refundAmount): void
    {
        if ($refundAmount <= 0 || $refundAmount >= (float) $booking->amount) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'Partial refund amount must be between 0 and the full booking amount.',
            );
        }

        // Refund the buyer portion
        $this->payment->initiatePartialRefund($booking, $refundAmount);

        // Recalculate commission on the retained gross
        $commission = Commission::where('booking_id', $booking->id)->first();
        if ($commission) {
            $this->commission->recalculateForPartialRefund($commission, $refundAmount);
        }

        $booking->update([
            'status'       => 'COMPLETED',
            'completed_at' => $booking->completed_at ?? now(),
        ]);

        // Payout the net-to-provider from the recalculated commission
        $this->payment->initiatePayout($booking);
    }
}
