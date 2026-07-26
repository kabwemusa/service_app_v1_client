<?php

namespace App\Support;

/**
 * § CTR-2 — single source of truth for customer-facing booking status labels.
 *
 * Previously each surface (RN, PWA, WhatsApp templates) mapped internal status
 * codes to display text independently, so they drifted. The backend now publishes
 * one neutral label on every booking payload (`status_label`); clients render
 * that instead of re-deriving their own.
 */
final class BookingStatusLabel
{
    private const LABELS = [
        'SCOPE_PENDING'      => 'Waiting for the provider’s quote',
        'REQUESTED'          => 'Request sent',
        'QUOTED'             => 'Quote received',
        'QUOTE_SENT'         => 'Quote received',
        'PENDING_PAYMENT'    => 'Awaiting payment',
        'PAYMENT_FAILED'     => 'Payment failed',
        'FUNDS_HELD'         => 'Funds held in escrow',
        'DEPOSIT_HELD'       => 'Deposit held in escrow',
        'ACCEPTED'           => 'Accepted',
        'IN_PROGRESS'        => 'In progress',
        'DELIVERED'          => 'Delivered — confirm to release',
        'COMPLETED'          => 'Completed',
        'DISBURSED'          => 'Completed',
        'DISPUTED'           => 'In dispute',
        'CHARGEBACK_PENDING' => 'Under review',
        'CANCELLED'          => 'Cancelled',
        'DECLINED'           => 'Declined',
        'EXPIRED'            => 'Expired',
        'NO_SHOW'            => 'No-show',
    ];

    public static function for(?string $status): string
    {
        if ($status === null) {
            return 'Booking';
        }
        return self::LABELS[$status] ?? ucfirst(strtolower(str_replace('_', ' ', $status)));
    }
}
