<?php

namespace App\Services;

use App\Exceptions\Api\BookingConflictException;
use App\Exceptions\Api\ApiException;
use App\Enums\ErrorCode;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Implements the three-step spatio-temporal conflict algorithm (Section 4.2).
 *
 * Step 1 — Availability Window Check
 *   Verify the requested [t_start, t_end] falls inside at least one window
 *   in the provider's availability_matrix for that weekday.
 *   Throws 422 if the provider is not available on that day/time.
 *
 * Step 2 — Overlap Check
 *   Query bookings WHERE provider_id = ? AND status IN ('FUNDS_HELD','IN_PROGRESS')
 *   AND time ranges overlap. Throws 409 BOOKING_CONFLICT if any row found.
 *
 * Step 3 — Transit Buffer
 *   Find the most recent booking ending before t_start. Compute travel distance
 *   at 30 km/h + 15-minute buffer. Throws 409 with reason TRANSIT_CONFLICT
 *   if there is not enough gap for the provider to travel.
 */
class BookingConflictService
{
    private const LUSAKA_TZ = 'Africa/Lusaka'; // UTC+2

    public function __construct() {}

    /**
     * Run all three checks. Throws on any conflict.
     *
     * @param  string  $providerId
     * @param  string  $scheduledStart  ISO 8601 datetime string
     * @param  string  $scheduledEnd    ISO 8601 datetime string
     * @param  float   $deliveryLat     Buyer's delivery latitude
     * @param  float   $deliveryLng     Buyer's delivery longitude
     * @param  array   $availabilityMatrix  Provider's availability_matrix JSONB
     */
    public function check(
        string $providerId,
        string $scheduledStart,
        string $scheduledEnd,
        float  $deliveryLat,
        float  $deliveryLng,
        array  $availabilityMatrix,
    ): void {
        $start = Carbon::parse($scheduledStart)->setTimezone(self::LUSAKA_TZ);
        $end   = Carbon::parse($scheduledEnd)->setTimezone(self::LUSAKA_TZ);

        $this->checkAvailabilityWindow($start, $end, $availabilityMatrix);
        $this->checkOverlap($providerId, $scheduledStart, $scheduledEnd);
        $this->checkTransitBuffer($providerId, $start, $scheduledStart, $deliveryLat, $deliveryLng);
    }

    // ── Step 1 ───────────────────────────────────────────────────────────────

    private function checkAvailabilityWindow(
        Carbon $start,
        Carbon $end,
        array  $matrix,
    ): void {
        // ISO weekday abbreviation: Mon→MON, Tue→TUE, etc.
        $day     = strtoupper(substr($start->englishDayOfWeek, 0, 3));
        $windows = $matrix[$day] ?? [];

        if (empty($windows)) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                "This provider is not available on {$start->englishDayOfWeek}s.",
            );
        }

        $reqStart = $start->format('H:i');
        $reqEnd   = $end->format('H:i');

        foreach ($windows as $window) {
            if ($reqStart >= $window['start'] && $reqEnd <= $window['end']) {
                return; // fits inside this window — OK
            }
        }

        throw new ApiException(
            ErrorCode::VALIDATION_ERROR,
            "The requested time ({$reqStart}–{$reqEnd}) falls outside this provider's availability windows.",
        );
    }

    // ── Step 2 ───────────────────────────────────────────────────────────────

    private function checkOverlap(
        string $providerId,
        string $scheduledStart,
        string $scheduledEnd,
    ): void {
        $overlap = DB::selectOne("
            SELECT id
            FROM   bookings
            WHERE  provider_id = ?
              AND  status IN ('FUNDS_HELD', 'IN_PROGRESS')
              AND  scheduled_start < ?::timestamptz
              AND  scheduled_end   > ?::timestamptz
            LIMIT  1
        ", [$providerId, $scheduledEnd, $scheduledStart]);

        if ($overlap) {
            throw new BookingConflictException(
                'This provider already has a confirmed booking that overlaps your requested time.',
            );
        }
    }

    // ── Step 3 ───────────────────────────────────────────────────────────────

    private function checkTransitBuffer(
        string $providerId,
        Carbon $start,
        string $scheduledStart,
        float  $deliveryLat,
        float  $deliveryLng,
    ): void {
        $speedKmh   = (float) config('search.search.max_radius_km', 10); // not ideal – use env
        $speedKmh   = (float) env('TRANSIT_SPEED_KMH', 30);
        $bufferMins = (float) env('TRANSIT_BUFFER_MINS', 15);

        $point = "ST_GeogFromText('POINT({$deliveryLng} {$deliveryLat})')";

        $prev = DB::selectOne("
            SELECT
                b.scheduled_end,
                ST_Distance(b.delivery_location, {$point}) AS distance_m
            FROM bookings b
            WHERE b.provider_id = ?
              AND b.status IN ('FUNDS_HELD', 'IN_PROGRESS')
              AND b.scheduled_end <= ?::timestamptz
              AND b.delivery_location IS NOT NULL
            ORDER BY b.scheduled_end DESC
            LIMIT 1
        ", [$providerId, $scheduledStart]);

        if (! $prev) {
            return; // no prior booking — no transit conflict possible
        }

        $prevEnd      = Carbon::parse($prev->scheduled_end);
        $distanceKm   = (float) $prev->distance_m / 1000;
        $tTransitMins = ($distanceKm / $speedKmh) * 60;
        $requiredGap  = $tTransitMins + $bufferMins; // total minutes needed

        $actualGapMins = $prevEnd->diffInMinutes($start, false);

        if ($actualGapMins < $requiredGap) {
            $needed = (int) ceil($requiredGap);
            $prevEndFmt = $prevEnd->setTimezone(self::LUSAKA_TZ)->format('H:i');

            $distStr = $distanceKm < 1
                ? round($distanceKm * 1000) . 'm'
                : round($distanceKm, 1) . 'km';

            throw new BookingConflictException(
                "TRANSIT_CONFLICT: Provider needs at least {$needed} min after {$prevEndFmt} "
                . "to travel from their previous job ({$distStr} away).",
            );
        }
    }
}
