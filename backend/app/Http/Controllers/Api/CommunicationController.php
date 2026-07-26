<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use App\Services\BookingService;
use App\Services\Communication\AfricasTalkingCallProvider;
use App\Services\CommunicationService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The provider↔customer communication layer: masked calling + structured status
 * updates. NO chat, NO VoIP — free-form conversation deep-links to WhatsApp on
 * the clients. Every endpoint is gated server-side by ContactWindow (funded +
 * active) inside CommunicationService.
 */
class CommunicationController extends Controller
{
    public function __construct(
        private readonly CommunicationService $comms,
        private readonly BookingService       $bookings,
    ) {}

    /**
     * POST /bookings/{id}/status-update — send one preset status update.
     * Body: { type: "ON_MY_WAY"|..., duration_mins?, note? }.
     */
    public function statusUpdate(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'type'          => ['required', 'string', 'max:24'],
            'duration_mins' => ['sometimes', 'integer'],
            'note'          => ['sometimes', 'string', 'max:280'],
        ]);

        $booking = $this->bookings->findOrFail($id, $request->user());

        $result = $this->comms->postStatusUpdate(
            $booking,
            $request->user(),
            $data['type'],
            array_intersect_key($data, array_flip(['duration_mins', 'note'])),
        );

        return ApiResponse::success(
            new BookingResource($result['booking']->load(['service', 'buyer', 'provider.providerProfile'])),
            'Update sent.',
        );
    }

    /**
     * POST /bookings/{id}/call — start a masked voice call to the other party.
     * Returns a client-safe payload: the proxy number + a message (bridge mode),
     * or a time-limited revealed number (the flagged reveal fallback only).
     */
    public function call(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->findOrFail($id, $request->user());
        $payload = $this->comms->initiateCall($booking, $request->user());

        return ApiResponse::success($payload, $payload['message']);
    }

    /**
     * GET /bookings/{id}/comms/timeline — chronological, PII-free feed of the
     * booking's communication events (status updates + calls) for both parties.
     */
    public function timeline(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->findOrFail($id, $request->user());
        return ApiResponse::success($this->comms->timeline($booking), 'Communication timeline retrieved.');
    }

    /**
     * POST /webhooks/africastalking/voice — Africa's Talking voice callback.
     *
     * On the FIRST leg being answered it returns <Dial> XML bridging to the other
     * party (both see the virtual number). On call-completion notifications it
     * records duration/outcome as metadata. PUBLIC (AT is the caller); AT signs
     * nothing, so this only ever acts on session refs we minted — it can move no
     * money and expose no number.
     */
    public function voiceWebhook(Request $request): Response
    {
        $sessionId = (string) $request->input('sessionId', '');
        $state     = strtoupper((string) $request->input('callSessionState', ''));

        // Terminal notification: record duration/outcome (metadata only).
        if ($request->filled('durationInSeconds') || in_array($state, ['COMPLETED', 'ACTIVE'], true)) {
            $status = match ($state) {
                'ACTIVE'    => 'IN_PROGRESS',
                'COMPLETED' => 'COMPLETED',
                default     => 'COMPLETED',
            };
            $duration = $request->filled('durationInSeconds') ? (int) $request->input('durationInSeconds') : null;
            $this->comms->recordCallEvent($sessionId, $status, $duration);
        }

        // First answered leg → bridge to the counterparty (Africa's Talking only).
        $provider = app(\App\Contracts\MaskedCallProvider::class);
        if ($provider instanceof AfricasTalkingCallProvider && $sessionId !== '') {
            $xml = $provider->bridgeResponse($sessionId);
            if ($xml) {
                return response($xml, 200, ['Content-Type' => 'application/xml']);
            }
        }

        return response('', 200);
    }
}
