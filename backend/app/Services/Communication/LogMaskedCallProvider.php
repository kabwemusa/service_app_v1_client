<?php

namespace App\Services\Communication;

use App\Contracts\MaskedCallProvider;
use Illuminate\Support\Facades\Log;

/**
 * Dev/test driver: records the intent to place a masked call and returns a
 * synthetic bridge session. It places NO real call and exposes NO real number,
 * so the whole flow (gating, metadata logging, timeline) is exercisable offline
 * and in tests without a telecom account. This is the default provider.
 */
class LogMaskedCallProvider implements MaskedCallProvider
{
    public function key(): string
    {
        return 'log';
    }

    public function initiate(CallRequest $request): CallResult
    {
        // Log only that a call was requested — never the real numbers.
        Log::info('LogMaskedCallProvider: masked call requested (no real call placed)', [
            'booking_id'     => $request->bookingId,
            'initiator_role' => $request->initiatorRole,
        ]);

        return new CallResult(
            provider:      $this->key(),
            mode:          'bridge',
            status:        'INITIATED',
            sessionRef:    'log-' . bin2hex(random_bytes(6)),
            maskedNumber:  config('communication.calling.africastalking.virtual_number') ?? '+260000000000',
            clientMessage: 'Connecting your call…',
            metadata:      ['simulated' => true],
        );
    }
}
