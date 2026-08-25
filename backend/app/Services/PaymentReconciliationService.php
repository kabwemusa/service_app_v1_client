<?php

namespace App\Services;

use App\Contracts\PaymentGateway;
use App\Models\Booking;
use App\Models\PaymentReconciliation;
use Illuminate\Support\Facades\Log;

/**
 * § ERR-2 — durable retry for money-path external calls that fail AFTER the local
 * state was committed. Instead of catch-and-log (which loses money on a lost log
 * line), the failure is recorded here and re-attempted by ReconcilePaymentsWorker
 * with backoff until it resolves or is abandoned for manual handling.
 *
 * This is a SAFETY NET, not the primary path: the caller still attempts the
 * gateway call inline first and only records here when that throws/fails.
 */
class PaymentReconciliationService
{
    public function __construct(private readonly PaymentGateway $gateway) {}

    /**
     * Record (or refresh) an open reconciliation for a booking + kind. Idempotent
     * per (booking, kind): a repeated failure updates the existing open row rather
     * than stacking duplicates.
     */
    public function record(
        Booking $booking,
        string $kind,
        ?float $amount,
        ?string $holdRef,
        ?string $phone,
        string $error,
    ): void {
        try {
            PaymentReconciliation::updateOrCreate(
                [
                    'booking_id' => $booking->id,
                    'kind'       => $kind,
                    'status'     => PaymentReconciliation::STATUS_PENDING,
                ],
                [
                    'amount'          => $amount,
                    'hold_ref'        => $holdRef,
                    'phone'           => $phone,
                    'last_error'      => mb_substr($error, 0, 1000),
                    'next_attempt_at' => now()->addMinutes($this->backoffMinutes(1)),
                ],
            );
        } catch (\Throwable $e) {
            // The safety net must never throw into the business path.
            Log::error('PaymentReconciliation: failed to record', [
                'booking_id' => $booking->id, 'kind' => $kind, 'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Re-attempt every due PENDING reconciliation. Returns a small summary for
     * the worker's log. Each item is independent — one failure never blocks the
     * rest.
     *
     * @return array{attempted:int, resolved:int, abandoned:int}
     */
    public function retryDue(): array
    {
        $due = PaymentReconciliation::where('status', PaymentReconciliation::STATUS_PENDING)
            ->where(function ($q) {
                $q->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now());
            })
            ->orderBy('next_attempt_at')
            ->limit(100)
            ->get();

        $attempted = 0;
        $resolved  = 0;
        $abandoned = 0;

        foreach ($due as $item) {
            $attempted++;
            $booking = Booking::with(['buyer', 'provider.providerProfile', 'service'])->find($item->booking_id);
            if (! $booking) {
                $item->update(['status' => PaymentReconciliation::STATUS_ABANDONED, 'last_error' => 'Booking no longer exists.']);
                $abandoned++;
                continue;
            }

            try {
                $ok = $this->attempt($item, $booking);
            } catch (\Throwable $e) {
                $ok = false;
                $item->last_error = mb_substr($e->getMessage(), 0, 1000);
            }

            if ($ok) {
                $item->update([
                    'status'      => PaymentReconciliation::STATUS_RESOLVED,
                    'resolved_at' => now(),
                    'attempts'    => $item->attempts + 1,
                ]);
                $resolved++;
                continue;
            }

            $attempts = $item->attempts + 1;
            $max      = (int) config('payment.reconciliation.max_attempts', 5);

            if ($attempts >= $max) {
                $item->update(['status' => PaymentReconciliation::STATUS_ABANDONED, 'attempts' => $attempts]);
                $abandoned++;
                Log::error('PaymentReconciliation: ABANDONED after max attempts — needs manual handling', [
                    'id' => $item->id, 'booking_id' => $item->booking_id, 'kind' => $item->kind,
                ]);
                continue;
            }

            $item->update([
                'attempts'        => $attempts,
                'next_attempt_at' => now()->addMinutes($this->backoffMinutes($attempts + 1)),
            ]);
        }

        return compact('attempted', 'resolved', 'abandoned');
    }

    /** Perform the kind-specific retry. Returns true when the money moved / is confirmed. */
    private function attempt(PaymentReconciliation $item, Booking $booking): bool
    {
        return match ($item->kind) {
            // A refund is its own outbound transfer with its own reference —
            // persist it so the async outcome reconciles back to the booking.
            PaymentReconciliation::KIND_REFUND => (function () use ($item, $booking) {
                $refundRef = $this->gateway->refund(
                    (string) $item->hold_ref,
                    (string) $item->phone,
                    (float) $item->amount,
                );
                if ($refundRef === null) {
                    return false;
                }
                $booking->update(['refund_ref' => $refundRef]);
                return true;
            })(),

            // Re-run the guarded disbursement; success is the booking landing DISBURSED.
            PaymentReconciliation::KIND_PAYOUT => (function () use ($booking) {
                app(BookingService::class)->disbursePayout($booking->fresh()->load('service', 'provider.providerProfile'));
                return $booking->fresh()->status === 'DISBURSED';
            })(),

            // Re-run balance collection; success is escrow_phase leaving DEPOSIT.
            PaymentReconciliation::KIND_BALANCE => (function () use ($booking) {
                app(BookingService::class)->collectBalance($booking->fresh()->load(['buyer', 'service']));
                return $booking->fresh()->escrow_phase !== 'DEPOSIT';
            })(),

            default => false,
        };
    }

    private function backoffMinutes(int $attemptNumber): int
    {
        $schedule = (array) config('payment.reconciliation.backoff_mins', [1 => 2, 2 => 10, 3 => 30]);
        return (int) ($schedule[$attemptNumber] ?? end($schedule) ?: 30);
    }
}
