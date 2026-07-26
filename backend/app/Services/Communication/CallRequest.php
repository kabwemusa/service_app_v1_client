<?php

namespace App\Services\Communication;

/**
 * A request to connect the two parties of a booking by masked voice call.
 * Carries the real MSISDNs only so far as the PROVIDER needs to bridge them —
 * they never leave this layer and are never returned to a client.
 */
final class CallRequest
{
    public function __construct(
        public readonly string $bookingId,
        public readonly string $initiatorRole,     // 'provider' | 'customer'
        public readonly string $initiatorPhone,    // real MSISDN — bridge-only
        public readonly string $counterpartyPhone, // real MSISDN — bridge-only
        public readonly int    $ttlMinutes,
    ) {}
}
