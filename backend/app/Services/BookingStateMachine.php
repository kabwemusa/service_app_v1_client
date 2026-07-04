<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Models\Booking;

/**
 * Unified escrow-first booking lifecycle (WhatsApp transformation).
 *
 * New bookings follow the escrow path:
 *   REQUESTED → QUOTED → FUNDS_HELD → IN_PROGRESS → DELIVERED → COMPLETED → DISBURSED
 *   Plus: DECLINED / EXPIRED / CANCELLED / NO_SHOW / DISPUTED
 *
 * Legacy DIRECT bookings (legacy_payment_mode = 'DIRECT') use the legacy table
 * for backward compatibility during migration.
 */
class BookingStateMachine
{
    private const ESCROW_TRANSITIONS = [
        'REQUESTED'       => ['QUOTED', 'PENDING_PAYMENT', 'FUNDS_HELD', 'DECLINED', 'CANCELLED', 'EXPIRED'],
        // Outcome-based pricing: quote-first models (PROVIDER_SCOPE / QUOTE_DEPOSIT)
        // start at SCOPE_PENDING (customer brief captured, awaiting provider's
        // scoped quote) → QUOTE_SENT (awaiting customer approval) → payment.
        'SCOPE_PENDING'   => ['QUOTE_SENT', 'DECLINED', 'CANCELLED', 'EXPIRED'],
        'QUOTE_SENT'      => ['PENDING_PAYMENT', 'FUNDS_HELD', 'DEPOSIT_HELD', 'CANCELLED', 'DECLINED', 'EXPIRED'],
        'PENDING_PAYMENT' => ['FUNDS_HELD', 'DEPOSIT_HELD', 'PAYMENT_FAILED', 'CANCELLED', 'EXPIRED'],
        'PAYMENT_FAILED'  => ['PENDING_PAYMENT', 'CANCELLED'],
        'QUOTED'          => ['PENDING_PAYMENT', 'FUNDS_HELD', 'DECLINED', 'CANCELLED', 'EXPIRED'],
        'FUNDS_HELD'      => ['IN_PROGRESS', 'CANCELLED'],
        // QUOTE_DEPOSIT: only the deposit is custodied; balance collected at completion.
        'DEPOSIT_HELD'    => ['IN_PROGRESS', 'CANCELLED'],
        'IN_PROGRESS' => ['DELIVERED', 'NO_SHOW'],
        'DELIVERED'   => ['COMPLETED', 'DISPUTED'],
        'COMPLETED'   => ['DISBURSED', 'CHARGEBACK_PENDING'],
        'DISPUTED'    => ['COMPLETED', 'CANCELLED', 'CHARGEBACK_PENDING'],
    ];

    private const LEGACY_DIRECT_TRANSITIONS = [
        'REQUESTED'   => ['ACCEPTED', 'QUOTED', 'DECLINED', 'CANCELLED', 'EXPIRED'],
        'QUOTED'      => ['ACCEPTED', 'CANCELLED'],
        'ACCEPTED'    => ['IN_PROGRESS', 'CANCELLED'],
        'IN_PROGRESS' => ['DELIVERED', 'NO_SHOW'],
        'DELIVERED'   => ['COMPLETED', 'DISPUTED'],
    ];

    public function assertTransition(Booking $booking, string $to): void
    {
        $from    = $booking->status;
        $allowed = $this->allowedTransitions($booking, $from);

        if (! in_array($to, $allowed, true)) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                "Cannot transition from {$from} to {$to}.",
            );
        }
    }

    public function canTransition(Booking $booking, string $to): bool
    {
        $from    = $booking->status;
        $allowed = $this->allowedTransitions($booking, $from);
        return in_array($to, $allowed, true);
    }

    public function isLegacyDirect(Booking $booking): bool
    {
        return $booking->legacy_payment_mode === 'DIRECT';
    }

    private function allowedTransitions(Booking $booking, string $from): array
    {
        if ($this->isLegacyDirect($booking)) {
            return self::LEGACY_DIRECT_TRANSITIONS[$from] ?? [];
        }

        return self::ESCROW_TRANSITIONS[$from] ?? [];
    }
}
