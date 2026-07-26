<?php

namespace App\Services\Communication;

use App\Contracts\MaskedCallProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Masked calling via Africa's Talking Voice — the only telecom API verified to
 * cover Zambia's MNOs (MTN / Airtel / Zamtel) for programmable voice.
 *
 * MECHANISM (true masking, no reveal):
 *   1. initiate() places an OUTBOUND call FROM our virtual number TO the party
 *      who tapped "Call". Africa's Talking rings their handset showing the
 *      virtual number as caller ID.
 *   2. When they answer, Africa's Talking hits our voice callback (the
 *      /webhooks/africastalking/voice route). We respond with a <Dial> to the
 *      OTHER party — again FROM the virtual number. Neither handset ever sees
 *      the other's real MSISDN; both only ever see the virtual number.
 *
 * The counterparty's real number is needed transiently to build that <Dial>,
 * so it is cached (short TTL) keyed by the AT session — NEVER written to durable
 * storage and NEVER returned to a client.
 *
 * Requires an Africa's Talking account + a provisioned Zambian voice number.
 * Until AT_USERNAME / AT_API_KEY / AT_VOICE_NUMBER are configured, initiate()
 * throws a clean error so the caller surfaces "calling is unavailable" rather
 * than half-completing.
 */
class AfricasTalkingCallProvider implements MaskedCallProvider
{
    public function key(): string
    {
        return 'africastalking';
    }

    public function initiate(CallRequest $request): CallResult
    {
        $cfg      = config('communication.calling.africastalking');
        $username = $cfg['username'] ?? null;
        $apiKey   = $cfg['api_key'] ?? null;
        $virtual  = $cfg['virtual_number'] ?? null;

        if (! $username || ! $apiKey || ! $virtual) {
            throw new RuntimeException('Africa\'s Talking voice is not configured (AT_USERNAME / AT_API_KEY / AT_VOICE_NUMBER).');
        }

        $response = Http::asForm()
            ->withHeaders(['apiKey' => $apiKey, 'Accept' => 'application/json'])
            ->post(rtrim($cfg['base_url'], '/') . '/call', [
                'username' => $username,
                'from'     => $virtual,
                'to'       => $request->initiatorPhone,
                // Correlate the eventual voice callback back to this booking.
                'clientRequestId' => $request->bookingId,
            ]);

        if (! $response->successful()) {
            Log::error('AfricasTalking voice: call API error', [
                'status'     => $response->status(),
                'booking_id' => $request->bookingId,
            ]);
            throw new RuntimeException('Could not start the call. Please try again.');
        }

        $entry     = $response->json('entries.0', []);
        $sessionId = $entry['sessionId'] ?? null;
        $status    = strtoupper((string) ($entry['status'] ?? 'QUEUED'));

        if (! $sessionId) {
            throw new RuntimeException('Call provider did not return a session.');
        }

        // Stash the counterparty number for the voice callback to bridge to —
        // transient only, keyed by the AT session, never persisted.
        Cache::put(
            $this->cacheKey($sessionId),
            $request->counterpartyPhone,
            now()->addMinutes($request->ttlMinutes),
        );

        return new CallResult(
            provider:      $this->key(),
            mode:          'bridge',
            status:        $status === 'QUEUED' ? 'INITIATED' : 'RINGING',
            sessionRef:    $sessionId,
            maskedNumber:  $virtual,
            clientMessage: 'We\'re calling you now — pick up to be connected. Both of you will only see our number.',
            metadata:      ['at_status' => $status],
        );
    }

    /**
     * Voice-callback bridge: given the AT session, return the <Dial> XML that
     * connects the answered leg to the counterparty (from the virtual number).
     * Returns null when the session is unknown/expired (AT then just plays a
     * default hang-up). The counterparty number is read from the transient cache
     * and never logged.
     */
    public function bridgeResponse(string $sessionId): ?string
    {
        $counterparty = Cache::pull($this->cacheKey($sessionId));
        if (! $counterparty) {
            return null;
        }

        $virtual = config('communication.calling.africastalking.virtual_number');

        return '<?xml version="1.0" encoding="UTF-8"?>'
            . '<Response>'
            . '<Dial phoneNumbers="' . htmlspecialchars($counterparty, ENT_QUOTES)
            . '" callerId="' . htmlspecialchars((string) $virtual, ENT_QUOTES) . '"/>'
            . '</Response>';
    }

    private function cacheKey(string $sessionId): string
    {
        return "at_call:bridge:{$sessionId}";
    }
}
