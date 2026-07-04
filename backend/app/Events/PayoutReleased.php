<?php

namespace App\Events;

use App\Models\Booking;

/**
 * Escrow payout disbursed to the provider's Mobile Money.
 * Fired by BookingService::disbursePayout (and the PawaPay payout callback's
 * late-confirm branch) so the provider hears about money the moment it moves.
 */
class PayoutReleased extends NotifiableEvent
{
    public function __construct(
        public readonly Booking $booking,
    ) {
        parent::__construct();
    }

    public function notificationType(): string { return 'PAYOUT_RELEASED'; }
    public function recipientId(): string { return $this->booking->provider_id; }
    public function entityType(): ?string { return 'booking'; }
    public function entityId(): ?string { return $this->booking->id; }
    public function paymentMode(): ?string { return 'ESCROW'; }
    public function settingsCategory(): string { return 'payments'; }
    public function isTimeCritical(): bool { return true; }

    public function title(): string { return 'Payout sent'; }

    public function body(): string
    {
        $amount = number_format($this->amountZmw(), 2);
        $service = $this->booking->service->title ?? 'your booking';
        return "ZMW {$amount} for {$service} has been sent to your Mobile Money.";
    }

    public function meta(): array
    {
        return [
            'amount'        => $this->amountZmw(),
            'service_title' => $this->booking->service->title ?? 'Service',
        ];
    }

    private function amountZmw(): float
    {
        return (float) ($this->booking->provider_split_zmw ?? $this->booking->amount);
    }
}
