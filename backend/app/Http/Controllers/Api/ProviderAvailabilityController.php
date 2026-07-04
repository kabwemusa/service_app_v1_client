<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AvailabilityService;
use App\Services\ProviderProfileService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Provider weekly availability + time-off blocks.
 *
 * This is the single write surface for the `provider_availability` table that
 * the WhatsApp date-picker, PWA date-picker and dispatch eligibility all read.
 * Writes are mirrored into the profile's legacy `availability_matrix` JSONB so
 * older read paths (Hub checklist, booking conflict check) stay consistent.
 */
class ProviderAvailabilityController extends Controller
{
    public function __construct(
        private readonly AvailabilityService     $availability,
        private readonly ProviderProfileService  $profiles,
    ) {}

    /** GET /provider/availability — weekly grid + upcoming blocked dates. */
    public function show(Request $request): JsonResponse
    {
        $providerId = $request->user()->id;

        return ApiResponse::success([
            'schedule'      => $this->availability->getSchedule($providerId),
            'blocked_dates' => $this->availability->blockedDates($providerId),
        ]);
    }

    /** PUT /provider/availability — replace the recurring weekly schedule. */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'slots'                => ['present', 'array'],
            'slots.*.day_of_week'  => ['required', 'integer', 'between:0,6'],
            'slots.*.start_time'   => ['required', 'date_format:H:i'],
            'slots.*.end_time'     => ['required', 'date_format:H:i', 'after:slots.*.start_time'],
        ]);

        $user = $request->user();

        $this->availability->setSchedule($user->id, $data['slots']);

        // Mirror into the legacy matrix so the Hub checklist + conflict check agree.
        $this->profiles->upsert($user, [
            'availability_matrix' => $this->availability->toMatrix($user->id),
        ]);

        return ApiResponse::success([
            'schedule'      => $this->availability->getSchedule($user->id),
            'blocked_dates' => $this->availability->blockedDates($user->id),
        ], 'Availability updated.');
    }

    /** POST /provider/availability/blocks — block a specific date (time off). */
    public function block(Request $request): JsonResponse
    {
        $data = $request->validate([
            'date' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
        ]);

        $providerId = $request->user()->id;
        $this->availability->blockDate($providerId, $data['date']);

        return ApiResponse::success([
            'blocked_dates' => $this->availability->blockedDates($providerId),
        ], 'Date blocked.');
    }

    /** DELETE /provider/availability/blocks/{date} — remove a time-off block. */
    public function unblock(Request $request, string $date): JsonResponse
    {
        $request->merge(['date' => $date])->validate([
            'date' => ['required', 'date_format:Y-m-d'],
        ]);

        $providerId = $request->user()->id;
        $this->availability->unblockDate($providerId, $date);

        return ApiResponse::success([
            'blocked_dates' => $this->availability->blockedDates($providerId),
        ], 'Date unblocked.');
    }
}
