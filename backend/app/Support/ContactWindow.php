<?php

namespace App\Support;

use App\Models\Booking;

/**
 * The single rule for WHEN the two parties may reach each other (masked call +
 * status updates). Shared by CommunicationService (enforcement) and
 * BookingResource (so the client can show/hide the Call button consistently).
 *
 * Contact opens only once money is custodied — never before funding, which is
 * the anti-circumvention line — and closes once the dispute window lapses on a
 * completed booking.
 */
final class ContactWindow
{
    public static function isOpen(Booking $booking): bool
    {
        $active = config('communication.contact_window.active_statuses', []);

        if (in_array($booking->status, $active, true)) {
            return true;
        }

        // After completion, keep contact open through the dispute window so the
        // parties can sort out any post-job issue, then close it.
        if ($booking->status === 'COMPLETED') {
            $hours = (int) config('communication.contact_window.dispute_window_hours', 48);
            $ref   = $booking->completed_at ?? $booking->updated_at;
            return $ref !== null && $ref->copy()->addHours($hours)->isFuture();
        }

        // DISBURSED, and every pre-funding / terminal state: closed.
        return false;
    }
}
