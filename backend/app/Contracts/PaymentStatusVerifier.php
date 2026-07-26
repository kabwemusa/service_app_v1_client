<?php

namespace App\Contracts;

/**
 * Authoritative status re-fetch for asynchronous payment callbacks.
 *
 * SECURITY: a payment callback body is attacker-controllable — the endpoint is
 * public and the {depositId}/{payoutId} references transit phones and logs. The
 * `status` a callback claims must therefore NEVER be trusted. A gateway that can
 * confirm the true status out-of-band (by calling the provider's read API)
 * implements this so the callback handler acts on the fetched status, not the
 * posted one. A forged "COMPLETED" then resolves to the real status (or UNKNOWN
 * for a reference that doesn't exist) and is ignored.
 *
 * Only real, money-moving gateways implement this. Stub/test gateways (bound only
 * when no real funds move) do not, and the handler falls back to the posted body.
 */
interface PaymentStatusVerifier
{
    /**
     * @param  string  $kind  'deposit' | 'payout' | 'refund'
     * @param  string  $ref   The gateway reference (depositId / payoutId / refundId)
     * @return string  Authoritative provider status (e.g. COMPLETED, FAILED,
     *                 REJECTED, ACCEPTED), or 'UNKNOWN' if it cannot be confirmed.
     */
    public function verifyStatus(string $kind, string $ref): string;
}
