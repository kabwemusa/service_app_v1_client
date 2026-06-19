<?php

namespace App\Events;

use App\Models\Booking;

class BookingExpired extends NotifiableEvent
{
    public function __construct(public readonly Booking $booking) { parent::__construct(); }

    public function notificationType(): string { return 'REQUEST_EXPIRED'; }
    public function recipientId(): string { return $this->booking->buyer_id; }
    public function entityType(): ?string { return 'booking'; }
    public function entityId(): ?string { return $this->booking->id; }
    public function paymentMode(): ?string { return $this->booking->payment_mode; }
    public function settingsCategory(): string { return 'bookings'; }

    public function title(): string { return 'Request expired'; }
    public function body(): string
    {
        return 'Your provider did not respond in time. Try searching for other available providers.';
    }
}
