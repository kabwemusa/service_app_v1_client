<?php

namespace App\Console\Commands;

use App\Models\Booking;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Runs every 5 minutes via the scheduler.
 *
 * Expires DIRECT bookings in REQUESTED state whose response window
 * (BOOKING_RESPONSE_WINDOW_HOURS, default 24 h) has elapsed without a
 * provider response.
 */
class BookingExpiryWorker extends Command
{
    protected $signature   = 'bookings:expire-requests';
    protected $description = 'Expire DIRECT REQUESTED bookings past the response window.';

    public function handle(): int
    {
        $due = Booking::where('payment_mode', 'DIRECT')
            ->where('status', 'REQUESTED')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<=', now())
            ->get();

        if ($due->isEmpty()) {
            return self::SUCCESS;
        }

        foreach ($due as $booking) {
            try {
                $booking->update(['status' => 'EXPIRED']);
                Log::info('BookingExpiryWorker: expired', ['booking_id' => $booking->id]);
            } catch (\Throwable $e) {
                Log::error('BookingExpiryWorker: failed', [
                    'booking_id' => $booking->id,
                    'error'      => $e->getMessage(),
                ]);
            }
        }

        $this->info("Expired {$due->count()} booking request(s).");

        return self::SUCCESS;
    }
}
