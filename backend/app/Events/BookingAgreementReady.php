<?php

namespace App\Events;

use App\Models\Booking;

/**
 * A Booking Agreement document (v{version}) was generated for a confirmed
 * booking. Both parties receive this so each can download the SAME document
 * from the app/PWA (and, when enabled, as a WhatsApp document message).
 */
class BookingAgreementReady extends NotifiableEvent
{
    public function __construct(
        public readonly Booking $booking,
        private readonly string $recipient,
        private readonly int    $version,
    ) {
        parent::__construct();
    }

    public function notificationType(): string { return 'AGREEMENT_READY'; }
    public function recipientId(): string { return $this->recipient; }
    public function entityType(): ?string { return 'booking'; }
    public function entityId(): ?string { return $this->booking->id; }
    public function paymentMode(): ?string { return $this->booking->payment_mode; }
    public function settingsCategory(): string { return 'bookings'; }

    public function title(): string { return 'Booking agreement ready'; }

    public function body(): string
    {
        $service = $this->booking->service?->title ?? 'your booking';
        return "Your booking agreement for {$service} is ready to download.";
    }

    public function meta(): array
    {
        return ['version' => $this->version];
    }
}
