<?php

namespace App\Events;

use App\Models\Booking;

class BookingAccepted extends NotifiableEvent
{
    public function __construct(public readonly Booking $booking) { parent::__construct(); }

    public function notificationType(): string { return 'REQUEST_ACCEPTED'; }
    public function recipientId(): string { return $this->booking->buyer_id; }
    public function entityType(): ?string { return 'booking'; }
    public function entityId(): ?string { return $this->booking->id; }
    public function paymentMode(): ?string { return $this->booking->payment_mode; }
    public function settingsCategory(): string { return 'bookings'; }

    public function title(): string { return 'Request accepted'; }

    public function body(): string
    {
        $service = $this->booking->service?->title ?? 'your request';
        return $this->booking->payment_mode === 'DIRECT'
            ? "Your provider accepted {$service}. You'll pay them directly."
            : "Your provider accepted {$service}. Payment is held in escrow.";
    }

    public function meta(): array
    {
        return [
            'booking_id'    => $this->booking->id,
            'service_title' => $this->booking->service?->title,
            'agreed_amount' => (float) ($this->booking->agreed_amount ?? $this->booking->amount),
        ];
    }
}
