<?php

namespace App\Events;

use App\Models\Booking;

class BookingDelivered extends NotifiableEvent
{
    public function __construct(public readonly Booking $booking) { parent::__construct(); }

    public function notificationType(): string { return 'CONFIRM_COMPLETION'; }
    public function recipientId(): string { return $this->booking->buyer_id; }
    public function entityType(): ?string { return 'booking'; }
    public function entityId(): ?string { return $this->booking->id; }
    public function paymentMode(): ?string { return $this->booking->payment_mode; }
    public function settingsCategory(): string { return 'bookings'; }

    public function title(): string { return 'Job delivered'; }
    public function body(): string
    {
        return $this->booking->payment_mode === 'DIRECT'
            ? 'Your provider marked the job as delivered. Confirm completion and pay your provider directly.'
            : 'Your provider marked the job as delivered. Confirm to release payment.';
    }

    public function meta(): array
    {
        return [
            'auto_confirm_at' => $this->booking->updated_at
                ?->copy()->addHours((int) config('booking.autoconfirm_hours', 24))->toIso8601String(),
        ];
    }
}
