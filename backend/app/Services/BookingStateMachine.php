<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Models\Booking;

/**
 * Single mode-aware transition table for the booking lifecycle (spec §12).
 *
 * DIRECT mode: provider acceptance = confirmation; no payment rails touched.
 * ESCROW mode: original v3 payment-driven transitions; MoMo fund custody.
 *
 * Every status mutation in BookingService must call assertTransition() first.
 * The mode is read from booking.payment_mode (set immutably on creation).
 */
class BookingStateMachine
{
    private const TRANSITIONS = [
        'DIRECT' => [
            'REQUESTED'   => ['ACCEPTED', 'QUOTED', 'DECLINED', 'CANCELLED', 'EXPIRED'],
            'QUOTED'      => ['ACCEPTED', 'CANCELLED'],
            'ACCEPTED'    => ['IN_PROGRESS', 'CANCELLED'],
            'IN_PROGRESS' => ['DELIVERED', 'NO_SHOW'],
            'DELIVERED'   => ['COMPLETED', 'DISPUTED'],
        ],
        'ESCROW' => [
            'PENDING_PAYMENT' => ['FUNDS_HELD', 'CANCELLED'],
            'AWAITING_KYC'    => ['PENDING_PAYMENT', 'FUNDS_HELD'],
            'FUNDS_HELD'      => ['IN_PROGRESS', 'CANCELLED'],
            'IN_PROGRESS'     => ['DELIVERED'],
            'DELIVERED'       => ['COMPLETED', 'DISPUTED'],
            'COMPLETED'       => ['DISBURSED', 'CHARGEBACK_PENDING'],
            'DISPUTED'        => ['COMPLETED', 'CANCELLED', 'CHARGEBACK_PENDING'],
        ],
    ];

    /**
     * Asserts the transition is valid for this booking's mode; throws on failure.
     */
    public function assertTransition(Booking $booking, string $to): void
    {
        $mode    = $booking->payment_mode ?? 'ESCROW';
        $from    = $booking->status;
        $allowed = self::TRANSITIONS[$mode][$from] ?? [];

        if (! in_array($to, $allowed, true)) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                "Cannot transition from {$from} to {$to} in {$mode} mode.",
            );
        }
    }

    public function canTransition(Booking $booking, string $to): bool
    {
        $mode    = $booking->payment_mode ?? 'ESCROW';
        $from    = $booking->status;
        $allowed = self::TRANSITIONS[$mode][$from] ?? [];

        return in_array($to, $allowed, true);
    }
}
