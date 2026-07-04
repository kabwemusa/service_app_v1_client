<?php

namespace App\Services;

use App\Exceptions\Api\ApiException;
use App\Enums\ErrorCode;
use App\Models\Booking;
use App\Models\ProviderAvailability;
use App\Models\ProviderService;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class AvailabilityService
{
    private const TZ = 'Africa/Lusaka';

    public function slotsForProvider(string $providerId, string $date): Collection
    {
        $dateObj = Carbon::parse($date)->setTimezone(self::TZ);
        $dayOfWeek = (int) $dateObj->dayOfWeek;

        $blocked = ProviderAvailability::where('provider_id', $providerId)
            ->where('specific_date', $dateObj->toDateString())
            ->where('is_blocked', true)
            ->exists();

        if ($blocked) {
            return collect();
        }

        $overrides = ProviderAvailability::where('provider_id', $providerId)
            ->where('specific_date', $dateObj->toDateString())
            ->where('is_blocked', false)
            ->get();

        if ($overrides->isNotEmpty()) {
            return $overrides->map(fn ($slot) => [
                'start' => $slot->start_time,
                'end'   => $slot->end_time,
            ]);
        }

        return ProviderAvailability::where('provider_id', $providerId)
            ->where('day_of_week', $dayOfWeek)
            ->where('is_recurring', true)
            ->get()
            ->map(fn ($slot) => [
                'start' => $slot->start_time,
                'end'   => $slot->end_time,
            ]);
    }

    public function openDates(string $providerId, int $daysAhead = 14): array
    {
        $dates = [];
        $today = Carbon::now(self::TZ)->startOfDay();

        for ($i = 0; $i < $daysAhead; $i++) {
            $date = $today->copy()->addDays($i);
            $slots = $this->slotsForProvider($providerId, $date->toDateString());
            if ($slots->isNotEmpty()) {
                $dates[] = [
                    'date'  => $date->toDateString(),
                    'day'   => $date->englishDayOfWeek,
                    'slots' => $slots->values()->all(),
                ];
            }
        }

        return $dates;
    }

    public function checkConflict(
        string $providerId,
        string $scheduledStart,
        string $scheduledEnd,
    ): void {
        $start = Carbon::parse($scheduledStart)->setTimezone(self::TZ);
        $end   = Carbon::parse($scheduledEnd)->setTimezone(self::TZ);

        $slots = $this->slotsForProvider($providerId, $start->toDateString());

        if ($slots->isEmpty()) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                "This provider is not available on {$start->englishDayOfWeek}s.",
            );
        }

        $reqStart = $start->format('H:i');
        $fits = false;

        foreach ($slots as $slot) {
            $slotStart = substr($slot['start'], 0, 5);
            $slotEnd   = substr($slot['end'], 0, 5);
            if ($reqStart >= $slotStart && $reqStart < $slotEnd) {
                $fits = true;
                break;
            }
        }

        if (! $fits) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                "The requested time ({$reqStart}) falls outside this provider's availability.",
            );
        }

        $overlap = DB::selectOne("
            SELECT id FROM bookings
            WHERE provider_id = ?
              AND status IN ('FUNDS_HELD', 'IN_PROGRESS', 'REQUESTED', 'ACCEPTED')
              AND scheduled_start < ?::timestamptz
              AND scheduled_end   > ?::timestamptz
            LIMIT 1
        ", [$providerId, $scheduledEnd, $scheduledStart]);

        if ($overlap) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'This provider already has a booking that overlaps your requested time.',
            );
        }
    }

    public function eligibleProviders(
        string $serviceId,
        string $date,
        string $startTime,
        string $endTime,
        ?float $lat = null,
        ?float $lng = null,
        ?float $radiusKm = null,
    ): Collection {
        $providerServices = ProviderService::where('service_id', $serviceId)
            ->where('status', 'ACTIVE')
            ->with(['provider.providerProfile'])
            ->whereHas('provider', function ($q) {
                $q->where('account_state', 'ACTIVE')
                    ->whereHas('providerProfile', fn ($inner) => $inner
                        ->where('trust_tier', '>=', 1)
                        ->where('accepting_bookings', true));
            })
            ->get();

        $dateObj = Carbon::parse($date)->setTimezone(self::TZ);
        $scheduledStart = $dateObj->copy()->setTimeFromTimeString($startTime)->toIso8601String();
        $scheduledEnd   = $dateObj->copy()->setTimeFromTimeString($endTime)->toIso8601String();

        return $providerServices->filter(function (ProviderService $ps) use ($scheduledStart, $scheduledEnd, $lat, $lng, $radiusKm) {
            $providerId = $ps->provider_id;

            $slots = $this->slotsForProvider($providerId, Carbon::parse($scheduledStart)->toDateString());
            if ($slots->isEmpty()) {
                return false;
            }

            $reqStart = Carbon::parse($scheduledStart)->setTimezone(self::TZ)->format('H:i');
            $reqEnd   = Carbon::parse($scheduledEnd)->setTimezone(self::TZ)->format('H:i');
            $fits = false;
            foreach ($slots as $slot) {
                if ($reqStart >= $slot['start'] && $reqEnd <= $slot['end']) {
                    $fits = true;
                    break;
                }
            }
            if (! $fits) {
                return false;
            }

            $overlap = DB::selectOne("
                SELECT id FROM bookings
                WHERE provider_id = ?
                  AND status IN ('FUNDS_HELD', 'IN_PROGRESS', 'REQUESTED', 'ACCEPTED')
                  AND scheduled_start < ?::timestamptz
                  AND scheduled_end   > ?::timestamptz
                LIMIT 1
            ", [$providerId, $scheduledEnd, $scheduledStart]);

            if ($overlap) {
                return false;
            }

            if ($lat !== null && $lng !== null && $radiusKm !== null) {
                $profile = $ps->provider->providerProfile;
                if (! $profile || $profile->base_location_lat === null) {
                    return false;
                }
                $distance = $this->haversineKm(
                    $lat, $lng,
                    $profile->base_location_lat,
                    $profile->base_location_lng,
                );
                $maxRadius = $profile->service_radius_km ?? $profile->max_radius_km ?? 50;
                if ($distance > min($radiusKm, $maxRadius)) {
                    return false;
                }
            }

            return true;
        })->values();
    }

    public function setSchedule(string $providerId, array $slots): void
    {
        DB::transaction(function () use ($providerId, $slots) {
            ProviderAvailability::where('provider_id', $providerId)
                ->where('is_recurring', true)
                ->delete();

            foreach ($slots as $slot) {
                ProviderAvailability::create([
                    'provider_id' => $providerId,
                    'day_of_week' => $slot['day_of_week'],
                    'start_time'  => $slot['start_time'],
                    'end_time'    => $slot['end_time'],
                    'is_recurring' => true,
                ]);
            }
        });
    }

    /**
     * The provider's recurring weekly schedule as stored rows.
     * Shape: [ ['day_of_week' => 1, 'start_time' => '08:00', 'end_time' => '17:00'], … ]
     */
    public function getSchedule(string $providerId): array
    {
        return ProviderAvailability::where('provider_id', $providerId)
            ->where('is_recurring', true)
            ->orderBy('day_of_week')
            ->orderBy('start_time')
            ->get()
            ->map(fn ($slot) => [
                'day_of_week' => (int) $slot->day_of_week,
                'start_time'  => substr($slot->start_time, 0, 5),
                'end_time'    => substr($slot->end_time, 0, 5),
            ])
            ->all();
    }

    /** Upcoming blocked (time-off) dates, today onward. */
    public function blockedDates(string $providerId): array
    {
        return ProviderAvailability::where('provider_id', $providerId)
            ->where('is_blocked', true)
            ->whereDate('specific_date', '>=', Carbon::now(self::TZ)->toDateString())
            ->orderBy('specific_date')
            ->pluck('specific_date')
            ->map(fn ($d) => Carbon::parse($d)->toDateString())
            ->all();
    }

    public function blockDate(string $providerId, string $date): void
    {
        ProviderAvailability::updateOrCreate(
            [
                'provider_id'   => $providerId,
                'specific_date' => $date,
                'is_blocked'    => true,
            ],
            [
                'day_of_week' => Carbon::parse($date)->dayOfWeek,
                'start_time'  => '00:00',
                'end_time'    => '23:59',
                'is_recurring' => false,
            ],
        );
    }

    public function unblockDate(string $providerId, string $date): void
    {
        ProviderAvailability::where('provider_id', $providerId)
            ->whereDate('specific_date', $date)
            ->where('is_blocked', true)
            ->delete();
    }

    // ── availability_matrix bridge ───────────────────────────────────────────
    //
    // The RN profile editor and older screens persist weekly hours as the
    // profile's `availability_matrix` JSONB ({MON: [{start,end}], …}). The
    // WhatsApp date-picker, dispatch eligibility and conflict checks all read
    // the relational `provider_availability` rows. These two helpers keep the
    // stores in lock-step regardless of which surface wrote first.

    private const MATRIX_DAYS = ['SUN' => 0, 'MON' => 1, 'TUE' => 2, 'WED' => 3, 'THU' => 4, 'FRI' => 5, 'SAT' => 6];

    /** Overwrite the recurring schedule from an availability_matrix payload. */
    public function syncFromMatrix(string $providerId, array $matrix): void
    {
        $slots = [];
        foreach (self::MATRIX_DAYS as $key => $dow) {
            foreach (($matrix[$key] ?? []) as $window) {
                if (empty($window['start']) || empty($window['end'])) {
                    continue;
                }
                $slots[] = [
                    'day_of_week' => $dow,
                    'start_time'  => substr($window['start'], 0, 5),
                    'end_time'    => substr($window['end'], 0, 5),
                ];
            }
        }

        $this->setSchedule($providerId, $slots);
    }

    /** Render the recurring schedule back into availability_matrix shape. */
    public function toMatrix(string $providerId): array
    {
        $byDow = array_flip(self::MATRIX_DAYS); // 0 => 'SUN', …

        $matrix = [];
        foreach ($this->getSchedule($providerId) as $slot) {
            $key = $byDow[$slot['day_of_week']] ?? null;
            if ($key === null) {
                continue;
            }
            $matrix[$key][] = ['start' => $slot['start_time'], 'end' => $slot['end_time']];
        }

        return $matrix;
    }

    private function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $R    = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a    = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return $R * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
