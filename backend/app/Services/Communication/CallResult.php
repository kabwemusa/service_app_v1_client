<?php

namespace App\Services\Communication;

/**
 * The outcome of a masked-call initiation. What a client is allowed to see.
 *
 * In 'bridge' mode (real masking) NO real number is ever present here — only
 * the proxy/masked number the provider set up. 'reveal' mode is the documented
 * FALLBACK: it carries a real counterparty number for a limited, consented
 * window (a flagged exception used only when masking cannot be provisioned).
 */
final class CallResult
{
    public function __construct(
        public readonly string  $provider,        // 'africastalking' | 'log' | 'reveal'
        public readonly string  $mode,            // 'bridge' | 'reveal'
        public readonly string  $status,          // INITIATED | RINGING | ...
        public readonly ?string $sessionRef,
        public readonly ?string $maskedNumber,    // proxy number (bridge mode)
        public readonly string  $clientMessage,   // human copy for the client
        public readonly ?string $revealedNumber = null,     // reveal fallback ONLY
        public readonly ?\DateTimeInterface $revealExpiresAt = null,
        public readonly array   $metadata = [],
    ) {}
}
