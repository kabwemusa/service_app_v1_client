<?php

namespace App\Events;

use App\Models\Booking;

/**
 * Provider receives a new booking request. TIME-CRITICAL: feeds the 30-min
 * Quick Responder window (§9.2). SMS fallback fires if push is not acked.
 */
class BookingRequested extends NotifiableEvent
{
    public function __construct(
        public readonly Booking $booking,
        public readonly string  $buyerLabel,
    ) {
        parent::__construct();
    }

    public function notificationType(): string { return 'NEW_BOOKING_REQUEST'; }
    public function recipientId(): string { return $this->booking->provider_id; }
    public function entityType(): ?string { return 'booking'; }
    public function entityId(): ?string { return $this->booking->id; }
    public function paymentMode(): ?string { return $this->booking->payment_mode; }
    public function settingsCategory(): string { return 'bookings'; }
    public function isTimeCritical(): bool { return true; }

    public function title(): string { return 'New booking request'; }

    public function body(): string
    {
        $service = $this->booking->service?->title ?? 'a service';
        return "{$this->buyerLabel} requested {$service}. Respond within 30 minutes to keep your Quick Responder status.";
    }

    public function meta(): array
    {
        return [
            'booking_id'      => $this->booking->id,
            'service_title'   => $this->booking->service?->title,
            'amount'          => (float) $this->booking->amount,
            'buyer_label'     => $this->buyerLabel,
            'expires_at'      => $this->booking->expires_at?->toIso8601String(),
            'response_deadline' => now()->addMinutes(30)->toIso8601String(),
        ];
    }
}
