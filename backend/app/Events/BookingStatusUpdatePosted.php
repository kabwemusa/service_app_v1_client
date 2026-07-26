<?php

namespace App\Events;

use App\Models\Booking;

/**
 * A structured status update ("On my way", "Arrived", …) was sent by one party;
 * this notifies the OTHER party in real time (app/PWA push + WhatsApp via the
 * NotificationDispatcher pipeline). The update itself is persisted separately as
 * immutable evidence (booking_status_updates) — this event is only the ping.
 */
class BookingStatusUpdatePosted extends NotifiableEvent
{
    public function __construct(
        public readonly Booking $booking,
        private readonly string $recipient,
        private readonly string $updateType,
        private readonly string $bodyText,
        private readonly bool   $critical,
    ) {
        parent::__construct();
    }

    public function notificationType(): string { return 'STATUS_UPDATE'; }
    public function recipientId(): string { return $this->recipient; }
    public function entityType(): ?string { return 'booking'; }
    public function entityId(): ?string { return $this->booking->id; }
    public function paymentMode(): ?string { return $this->booking->payment_mode; }
    public function settingsCategory(): string { return 'bookings'; }
    public function isTimeCritical(): bool { return $this->critical; }

    public function title(): string { return 'Booking update'; }
    public function body(): string { return $this->bodyText; }

    public function meta(): array
    {
        return ['status_update_type' => $this->updateType];
    }
}
