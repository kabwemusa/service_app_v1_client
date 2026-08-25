<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use App\Services\BookingService;
use App\Services\CommunicationService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The provider↔customer communication layer: structured status updates only.
 * NO chat, NO VoIP, NO masked calling — the parties dial each other directly
 * (BookingResource releases the number inside the same window) and free-form
 * conversation deep-links to WhatsApp on the clients. Every endpoint is gated
 * server-side by ContactWindow (funded + active) inside CommunicationService.
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
     * GET /bookings/{id}/comms/timeline — chronological, PII-free feed of the
     * booking's communication events (status updates + calls) for both parties.
     */
    public function timeline(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->findOrFail($id, $request->user());
        return ApiResponse::success($this->comms->timeline($booking), 'Communication timeline retrieved.');
    }
}
