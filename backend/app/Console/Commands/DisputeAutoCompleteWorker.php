<?php

namespace App\Console\Commands;

use App\Models\Booking;
use App\Services\PaymentService;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Runs every 15 minutes via the scheduler.
 *
 * Auto-completes DELIVERED bookings after DISPUTE_WINDOW_HOURS (default 48 h)
 * with no dispute raised, releasing funds to the provider per spec Section 5.1.
 */
class DisputeAutoCompleteWorker extends Command
{
    protected $signature   = "escrow:auto-complete";
    protected $description = "Auto-complete DELIVERED bookings past the dispute window.";

    public function __construct(private readonly PaymentService $payment)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $windowHours = (int) config("payment.dispute_window_hours", 48);
        $cutoff      = Carbon::now()->subHours($windowHours);

        $due = Booking::where("status", "DELIVERED")
            ->where("updated_at", "<=", $cutoff)
            ->with(["service", "provider"])
            ->get();

        if ($due->isEmpty()) {
            return self::SUCCESS;
        }

        foreach ($due as $booking) {
            try {
                $booking->update(["status" => "COMPLETED"]);

                // ESCROW only: initiate payout through MoMo.
                // DIRECT bookings auto-complete without payment rails.
                if (($booking->payment_mode ?? "ESCROW") === "ESCROW") {
                    $this->payment->initiatePayout($booking);
                }

                Log::info("DisputeAutoCompleteWorker: auto-completed booking", ["booking_id" => $booking->id]);
            } catch (\Throwable $e) {
                Log::error("DisputeAutoCompleteWorker: failed for booking", [
                    "booking_id" => $booking->id,
                    "error"      => $e->getMessage(),
                ]);
            }
        }

        $this->info("Auto-completed {$due->count()} booking(s).");

        return self::SUCCESS;
    }
}
