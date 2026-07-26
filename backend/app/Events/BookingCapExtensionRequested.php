<?php

namespace App\Events;

use App\Models\Booking;

/**
 * HOURLY_CAPPED — the observed timer is approaching the approved cap and the
 * provider has asked the customer to approve an extension (a higher hold). The
 * customer decides; the cap is never exceeded without this explicit approval.
 */
class BookingCapExtensionRequested extends NotifiableEvent
{
    public function __construct(public readonly Booking $booking) { parent::__construct(); }

    public function notificationType(): string { return 'JOB_CAP_EXTENSION_REQUESTED'; }
    public function recipientId(): string { return $this->booking->buyer_id; }
    public function entityType(): ?string { return 'booking'; }
    public function entityId(): ?string { return $this->booking->id; }
    public function paymentMode(): ?string { return $this->booking->payment_mode; }
    public function settingsCategory(): string { return 'bookings'; }

    public function title(): string { return 'Approve more time?'; }
    public function body(): string
    {
        $service = $this->booking->service?->title ?? 'your job';
        return "The provider needs more time on {$service} and has asked you to approve a higher cap.";
    }
}
