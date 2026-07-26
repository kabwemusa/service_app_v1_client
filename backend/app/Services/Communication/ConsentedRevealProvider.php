<?php

namespace App\Services\Communication;

use App\Contracts\MaskedCallProvider;
use Illuminate\Support\Facades\Log;

/**
 * FALLBACK ONLY — do not enable unless masked calling cannot be provisioned.
 *
 * When no masking number is available, the spec's documented fallback is a
 * time-limited, CONSENTED reveal of the counterparty's number so the parties
 * can still call each other. This is a deliberate, FLAGGED exception to the
 * "real numbers are never exposed" rule (see config/communication.php and
 * LEGAL_REVIEW.md → "Masked calling fallback"). It exposes ONE number, to ONE
 * party, for a limited window, and the reveal is recorded as call metadata.
 *
 * Because it exposes a real number, it weakens anti-circumvention — hence it is
 * OFF by default and must be a conscious operational choice.
 */
class ConsentedRevealProvider implements MaskedCallProvider
{
    public function key(): string
    {
        return 'reveal';
    }

    public function initiate(CallRequest $request): CallResult
    {
        $ttl       = (int) config('communication.calling.reveal_ttl_minutes', 60);
        $expiresAt = now()->addMinutes($ttl);

        Log::warning('ConsentedRevealProvider: real number revealed (masking fallback active)', [
            'booking_id'     => $request->bookingId,
            'initiator_role' => $request->initiatorRole,
            'expires_at'     => $expiresAt->toIso8601String(),
        ]);

        return new CallResult(
            provider:        $this->key(),
            mode:            'reveal',
            status:          'INITIATED',
            sessionRef:      null,
            maskedNumber:    null,
            clientMessage:   'Masked calling is unavailable right now, so the number below is shared with your consent for a limited time. Please keep all arrangements on the platform.',
            revealedNumber:  $request->counterpartyPhone,
            revealExpiresAt: $expiresAt,
            metadata:        ['fallback' => true, 'ttl_minutes' => $ttl],
        );
    }
}
