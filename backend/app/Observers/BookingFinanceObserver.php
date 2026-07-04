<?php

namespace App\Observers;

use App\Events\AdminQueueEvent;
use App\Models\Booking;

/**
 * Fires the Finance module's real-time events off the ESCROW status
 * transitions BookingService already makes (holdFunds/complete/
 * disbursePayout/cancel) — see backend/app/Services/BookingService.php.
 */
class BookingFinanceObserver
{
    private const STATUS_TO_TYPE = [
        'FUNDS_HELD' => 'booking.funds_held',
        'DISBURSED'  => 'booking.disbursed',
        'CANCELLED'  => 'booking.cancelled',
    ];

    public function updated(Booking $booking): void
    {
        if (! $booking->wasChanged('status')) {
            return;
        }

        $type = self::STATUS_TO_TYPE[$booking->status] ?? null;
        if ($type === null) {
            return;
        }

        AdminQueueEvent::fire('finance', $type, $booking->id, [
            'booking_id'      => $booking->id,
            'status'          => $booking->status,
            'amount'          => (float) ($booking->agreed_amount ?? $booking->amount),
            'commission_zmw'  => (float) ($booking->commission_split_zmw ?? 0),
            'provider_id'     => $booking->provider_id,
            'buyer_id'        => $booking->buyer_id,
        ]);
    }
}
