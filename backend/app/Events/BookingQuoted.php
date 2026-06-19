<?php

namespace App\Events;

use App\Models\Booking;

class BookingQuoted extends NotifiableEvent
{
    public function __construct(public readonly Booking $booking) { parent::__construct(); }

    public function notificationType(): string { return 'QUOTE_RECEIVED'; }
    public function recipientId(): string { return $this->booking->buyer_id; }
    public function entityType(): ?string { return 'booking'; }
    public function entityId(): ?string { return $this->booking->id; }
    public function paymentMode(): ?string { return $this->booking->payment_mode; }
    public function settingsCategory(): string { return 'bookings'; }

    public function title(): string { return 'Quote received'; }
    public function body(): string
    {
        $amount = number_format((float) $this->booking->agreed_amount, 2);
        return "Your provider quoted ZMW {$amount}. Review and accept or decline.";
    }

    public function meta(): array
    {
        return ['quoted_amount' => (float) $this->booking->agreed_amount];
    }
}
