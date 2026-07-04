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
}
