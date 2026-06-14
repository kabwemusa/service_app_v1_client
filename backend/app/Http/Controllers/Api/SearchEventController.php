<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * v3.2 §7 — funnel events referencing a search impression. Append-only;
 * fire-and-forget for the client (always 202-style success when the
 * impression exists).
 */
class SearchEventController extends Controller
{
    /** POST /events/result-clicked */
    public function resultClicked(Request $request): JsonResponse
    {
        return $this->store($request, 'RESULT_CLICKED');
    }

    /** POST /events/booking-started */
    public function bookingStarted(Request $request): JsonResponse
    {
        return $this->store($request, 'BOOKING_STARTED');
    }

    private function store(Request $request, string $type): JsonResponse
    {
        $data = $request->validate([
            'impression_id' => ['required', 'uuid'],
            'service_id'    => ['nullable', 'uuid'],
            'provider_id'   => ['nullable', 'uuid'],
        ]);

        // The impression row is written asynchronously, so it may land a
        // moment after the search response — insert without a hard FK check
        // and let the FK constraint reject true orphans quietly.
        try {
            DB::table('search_impression_events')->insert([
                'impression_id' => $data['impression_id'],
                'event_type'    => $type,
                'service_id'    => $data['service_id'] ?? null,
                'provider_id'   => $data['provider_id'] ?? null,
            ]);
        } catch (\Throwable) {
            // Orphan or duplicate — instrumentation never errors user flows.
        }

        return ApiResponse::success(null, 'Event recorded.');
    }
}
