<?php

namespace App\Contracts;

use App\Services\Communication\CallRequest;
use App\Services\Communication\CallResult;

/**
 * Connects the two parties of a booking by voice WITHOUT either learning the
 * other's real number. Implementations bridge the two legs through a proxy
 * (masked) number. The active driver is selected by
 * config('communication.calling.provider') and bound in AppServiceProvider.
 */
interface MaskedCallProvider
{
    /** Stable key for logging / persistence ('africastalking'|'log'|'reveal'). */
    public function key(): string;

    /**
     * Begin a masked call. Real MSISDNs enter here (to bridge) but NEVER leave
     * in bridge mode — the CallResult carries only the proxy number. Throws on
     * an unrecoverable provider error so the caller can surface a clean message.
     */
    public function initiate(CallRequest $request): CallResult;
}
