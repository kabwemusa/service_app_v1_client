<?php

namespace App\Console\Commands;

use App\Models\Booking;
use App\Services\BookingService;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Runs every 15 minutes via the scheduler.
 *
 * Auto-completes DELIVERED bookings after DISPUTE_WINDOW_HOURS (default 48 h)
 * with no dispute raised, per spec Section 5.1.
 *
 * Uses BookingService::autoComplete so the FULL completion money flow runs —
 * commission recorded, payout hold timer set, hourly-capped refund issued,
 * quote-deposit balance collected. (It previously only flipped the status and
 * called the legacy transaction-based payout, which never worked for gateway
 * escrow bookings: no PAY_IN row → exception → no payout_eligible_at → the
 * due-payout batch never saw the booking. Providers were never paid.)
 */
class DisputeAutoCompleteWorker extends Command
{
    protected $signature   = "escrow:auto-complete";
    protected $description = "Auto-complete DELIVERED bookings past the dispute window.";

    public function __construct(private readonly BookingService $bookings)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $windowHours = (int) config("payment.dispute_window_hours", 48);
        $cutoff      = Carbon::now()->subHours($windowHours);

        $due = Booking::where("status", "DELIVERED")
            ->where("updated_at", "<=", $cutoff)
            ->get();

        if ($due->isEmpty()) {
            return self::SUCCESS;
        }

        foreach ($due as $booking) {
            try {
                $this->bookings->autoComplete($booking->id);
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
