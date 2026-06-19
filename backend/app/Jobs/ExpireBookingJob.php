<?php

namespace App\Jobs;

use App\Events\BookingExpired;
use App\Models\Booking;
use App\Services\BookingService;
use App\Services\NotificationDispatcher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Server-authoritative booking expiry.
 *
 * Dispatched with a delay equal to the response window when a booking is
 * created. At execution time, checks whether the booking is still REQUESTED
 * (provider may have responded). If still REQUESTED, transitions to EXPIRED
 * and fires the BookingExpired notification.
 *
 * The deadline = booking.created_at + response_window_hours. The client renders
 * the countdown from event_time (= booking.created_at) + synced clock. The server
 * fires the EXPIRE transition at the deadline — not the client.
 */
class ExpireBookingJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public array $backoff = [10, 60, 300];

    public function __construct(
        public readonly string $bookingId,
    ) {}

    public function handle(BookingService $bookings, NotificationDispatcher $dispatcher): void
    {
        $booking = Booking::find($this->bookingId);
        if (!$booking) return;

        // Only expire REQUESTED bookings in DIRECT mode
        if ($booking->status !== 'REQUESTED') {
            Log::info('ExpireBookingJob: booking no longer REQUESTED, skipping', [
                'booking_id' => $this->bookingId,
                'status'     => $booking->status,
            ]);
            return;
        }

        $bookings->expire($this->bookingId);

        $booking->refresh()->load('service');

        // Notify buyer that request expired
        $dispatcher->dispatch(new BookingExpired($booking));

        Log::info('ExpireBookingJob: booking expired', [
            'booking_id' => $this->bookingId,
        ]);
    }
}
