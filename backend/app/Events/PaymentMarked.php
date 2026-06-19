<?php

namespace App\Events;

use App\Models\Booking;

/**
 * One party marked payment as paid (DIRECT mode two-party confirmation).
 * TIME-CRITICAL when customer marks paid → prompts provider to confirm/settle.
 */
class PaymentMarked extends NotifiableEvent
{
    public function __construct(
        public readonly Booking $booking,
        public readonly string  $markedBy, // 'customer' | 'provider'
    ) {
        parent::__construct();
    }

    public function notificationType(): string
    {
        return $this->markedBy === 'customer' ? 'CUSTOMER_MARKED_PAID' : 'PAY_REMINDER';
    }

    public function recipientId(): string
    {
        return $this->markedBy === 'customer'
            ? $this->booking->provider_id
            : $this->booking->buyer_id;
    }

    public function entityType(): ?string { return 'booking'; }
    public function entityId(): ?string { return $this->booking->id; }
    public function paymentMode(): ?string { return 'DIRECT'; }
    public function settingsCategory(): string { return 'payments'; }
    public function isTimeCritical(): bool { return true; }

    public function title(): string
    {
        return $this->markedBy === 'customer'
            ? 'Customer marked as paid'
            : 'Provider confirmed payment';
    }

    public function body(): string
    {
        $amount = number_format((float) ($this->booking->agreed_amount ?? $this->booking->amount), 2);
        return $this->markedBy === 'customer'
            ? "The customer marked ZMW {$amount} as paid. Confirm you received the payment."
            : "Your provider confirmed receiving ZMW {$amount}.";
    }

    public function meta(): array
    {
        return [
            'amount'    => (float) ($this->booking->agreed_amount ?? $this->booking->amount),
            'marked_by' => $this->markedBy,
        ];
    }
}
