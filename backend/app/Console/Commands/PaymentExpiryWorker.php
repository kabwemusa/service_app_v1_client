<?php

namespace App\Console\Commands;

use App\Models\Booking;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Runs every minute via the scheduler.
 *
 * Cancels any booking stuck in PENDING_PAYMENT for longer than
 * PAYMENT_TTL_MINS (default 60 minutes), per the spec.
 */
class PaymentExpiryWorker extends Command
{
    protected $signature   = "escrow:expire-payments";
    protected $description = "Auto-cancel PENDING_PAYMENT bookings that have exceeded the payment TTL.";

    public function handle(): int
    {
        $ttlMins  = (int) config("payment.ttl_mins", 60);
        $cutoff   = Carbon::now()->subMinutes($ttlMins);

        $expired = Booking::where("status", "PENDING_PAYMENT")
            ->where("created_at", "<=", $cutoff)
            ->get();

        if ($expired->isEmpty()) {
            return self::SUCCESS;
        }

        foreach ($expired as $booking) {
            // Never cancel a booking the customer actually paid for. The lifecycle
            // normally advances on the gateway callback, but a callback can be
            // missed (unreachable URL, exhausted retries) — and cancelling then
            // would strand real money at the processor with nothing left to
            // reconcile it against. Ask the gateway before writing CANCELLED.
            if ($this->wasActuallyPaid($booking)) {
                continue;
            }

            $booking->update(["status" => "CANCELLED"]);
            Log::info("PaymentExpiryWorker: expired booking cancelled", [
                "booking_id" => $booking->id,
                "created_at" => $booking->created_at,
            ]);

            // WhatsApp bookings: tell the customer and release the conversation
            // so it isn't stuck in FUNDING (and the timeout job doesn't double-fire).
            try {
                $convo = \App\Models\ConversationState::where("booking_id", $booking->id)
                    ->whereIn("state", ["FUNDING", "PAYMENT_FAILED"])
                    ->first();

                if ($convo) {
                    app(\App\Services\WhatsApp\TemplateManager::class)->sendMessage(
                        $convo->whatsapp_id,
                        "Your payment window has expired and the booking was cancelled — no money was taken. You can start a new booking anytime.",
                        $convo,
                    );
                    $convo->update(["state" => "EXPIRED", "sub_state" => null, "timeout_at" => null]);
                }
            } catch (\Throwable $e) {
                Log::warning("PaymentExpiryWorker: customer notify failed", [
                    "booking_id" => $booking->id,
                    "error"      => $e->getMessage(),
                ]);
            }
        }

        $this->info("Expired {$expired->count()} payment(s).");

        return self::SUCCESS;
    }

    /**
     * Did the money actually arrive while we weren't listening?
     *
     * Returns true only when the gateway positively confirms the collection
     * COMPLETED — in which case the booking is handed to the same processor the
     * callback would have used, and expiry is skipped.
     *
     * Everything else (PENDING — the ordinary case, the customer never answered;
     * FAILED; UNKNOWN; no gateway that can verify) falls through to the existing
     * cancel behaviour. UNKNOWN is logged loudly because it is the one case where
     * we cancel without being able to tell.
     */
    private function wasActuallyPaid(Booking $booking): bool
    {
        $reference = $booking->escrow_hold_ref;

        if (! $reference) {
            return false;
        }

        $gateway = app(\App\Contracts\PaymentGateway::class);

        if (! $gateway instanceof \App\Contracts\PaymentStatusVerifier) {
            return false;
        }

        try {
            $status = $gateway->verifyStatus("deposit", $reference);
        } catch (\Throwable $e) {
            Log::error("PaymentExpiryWorker: could not verify before expiring — cancelling blind", [
                "booking_id" => $booking->id,
                "reference"  => $reference,
                "error"      => $e->getMessage(),
            ]);
            return false;
        }

        if ($status === "COMPLETED") {
            Log::warning("PaymentExpiryWorker: booking was PAID but its callback never arrived — "
                . "advancing instead of cancelling", [
                    "booking_id" => $booking->id,
                    "reference"  => $reference,
                ]);

            app(\App\Services\Payments\PaymentEventProcessor::class)->record(
                $reference, "collection", $status, ["provider" => "lipila", "source" => "expiry-guard"],
            );
            app(\App\Services\Payments\PaymentEventProcessor::class)->collection(
                $reference, $status, ["provider" => "lipila", "source" => "expiry-guard"],
            );

            return true;
        }

        if ($status === "UNKNOWN") {
            Log::warning("PaymentExpiryWorker: gateway could not confirm the collection; cancelling anyway", [
                "booking_id" => $booking->id,
                "reference"  => $reference,
            ]);
        }

        return false;
    }
}
