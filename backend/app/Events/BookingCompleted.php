<?php

namespace App\Events;

use App\Models\Booking;

class BookingCompleted extends NotifiableEvent
{
    public function __construct(public readonly Booking $booking) { parent::__construct(); }

    public function notificationType(): string { return 'LEAVE_REVIEW'; }
    public function recipientId(): string { return $this->booking->buyer_id; }
    public function entityType(): ?string { return 'booking'; }
    public function entityId(): ?string { return $this->booking->id; }
    public function paymentMode(): ?string { return $this->booking->payment_mode; }
    public function settingsCategory(): string { return 'reviews'; }

    public function title(): string { return 'How was the service?'; }
    public function body(): string
    {
        $service = $this->booking->service?->title ?? 'the service';
        return "Leave a review for {$service} to help other customers.";
    }
}
