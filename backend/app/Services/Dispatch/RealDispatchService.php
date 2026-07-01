<?php

namespace App\Services\Dispatch;

use App\Contracts\DispatchService;
use App\Contracts\TrustEngine;
use App\Models\Booking;
use App\Models\ProviderProfile;
use App\Models\ProviderService;
use App\Models\TrustSignal;
use App\Models\User;
use App\Services\AvailabilityService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class RealDispatchService implements DispatchService
{
    public function __construct(
        private readonly TrustEngine          $trust,
        private readonly AvailabilityService  $availability,
        private readonly RequestClassifier    $classifier,
    ) {}

    // ── Shortlist: top N eligible, ranked by trust score ────────────────────

    public function shortlist(
        string $serviceId,
        float  $lat,
        float  $lng,
        string $scheduledStart,
        string $scheduledEnd,
        array  $preferences = [],
    ): array {
        $classification = $this->classifier->classify($serviceId, $scheduledStart);
        $geoRings       = $this->classifier->geoRings($classification['geo_mode']);

        $candidates = $this->findEligibleCandidates(
            $serviceId, $lat, $lng, $scheduledStart, $scheduledEnd, $geoRings,
        );

        if ($candidates->isEmpty()) {
            Log::info('RealDispatchService::shortlist — no eligible candidates', [
                'service' => $serviceId,
                'classification' => $classification,
            ]);
            return [];
        }

        $scored = $candidates->map(function (array $candidate) {
            $score = $this->trustScore($candidate['provider_id']);
            return array_merge($candidate, ['score' => $score]);
        });

        $fairnessShare = config('dispatch.fairness.shortlist_share', 0.20);
        $shortlistSize = config('dispatch.shortlist_size', 3);

        $scored = $this->applyFairnessFloor($scored, $fairnessShare, $shortlistSize);

        $sorted = $scored->sortByDesc('score')->values();

        $result = $sorted->take($shortlistSize)->map(function (array $item) {
            $surface = $this->trust->publicSurface($item['provider_id']);
            return [
                'provider_id' => $item['provider_id'],
                'name'        => $item['name'],
                'score'       => round($item['score'], 2),
                'price'       => $item['price'],
                'distance_km' => round($item['distance_km'], 1),
                'tier'        => $surface['tier'],
                'tier_label'  => $surface['tier_label'],
                'is_new'      => in_array('NEW', $surface['earned_badges']),
                'verified_facts' => $surface['verified_facts'],
            ];
        })->values()->all();

        Log::info('RealDispatchService::shortlist', [
            'service'  => $serviceId,
            'mode'     => $classification['service_mode'],
            'risk'     => $classification['risk_tier'],
            'found'    => count($result),
            'total_eligible' => $candidates->count(),
        ]);

        return $result;
    }

    // ── Auto-match: best single provider for instant dispatch ────────────────

    public function autoMatch(
        string $serviceId,
        float  $lat,
        float  $lng,
        string $scheduledStart,
        string $scheduledEnd,
    ): ?array {
        $shortlist = $this->shortlist($serviceId, $lat, $lng, $scheduledStart, $scheduledEnd);
        return $shortlist[0] ?? null;
    }

    // ── Cascade: advance to next candidate after decline/timeout ────────────

    public function cascade(string $bookingId): ?array
    {
        $booking = Booking::with('service')->find($bookingId);
        if (! $booking) return null;

        $convoState = DB::table('conversation_states')
            ->where('booking_id', $bookingId)
            ->whereNull('deleted_at')
            ->first();

        if (! $convoState) return null;

        $context = json_decode($convoState->context ?? '{}', true);
        $shortlist = $context['shortlist'] ?? [];
        $index     = ($context['shortlist_index'] ?? 0) + 1;

        if ($index >= count($shortlist)) {
            Log::info('RealDispatchService::cascade — exhausted', ['booking' => $bookingId]);
            return null;
        }

        DB::table('conversation_states')
            ->where('id', $convoState->id)
            ->update([
                'context' => json_encode(array_merge($context, ['shortlist_index' => $index])),
                'updated_at' => now(),
            ]);

        $next = $shortlist[$index];

        Log::info('RealDispatchService::cascade', [
            'booking' => $bookingId,
            'next'    => $next['provider_id'],
            'index'   => $index,
        ]);

        return [
            'provider_id' => $next['provider_id'],
            'price'       => $next['price'] ?? 0,
        ];
    }

    // ── Eligibility pipeline ────────────────────────────────────────────────

    private function findEligibleCandidates(
        string $serviceId,
        float  $lat,
        float  $lng,
        string $scheduledStart,
        string $scheduledEnd,
        array  $geoRings,
    ): \Illuminate\Support\Collection {
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

        $maxRingRadius = max(array_column($geoRings, 'radius_km'));
        $isNationwide  = $maxRingRadius >= 99999;

        $startCarbon = Carbon::parse($scheduledStart, 'Africa/Lusaka');
        $date = $startCarbon->toDateString();
        $startTime = $startCarbon->format('H:i');
        $endTime   = Carbon::parse($scheduledEnd, 'Africa/Lusaka')->format('H:i');

        $candidates = collect();

        foreach ($providerServices as $ps) {
            $providerId = $ps->provider_id;
            $profile    = $ps->provider->providerProfile;

            if (! $profile) continue;

            $eligibility = $this->trust->checkEligibility($providerId, $serviceId);
            if (! $eligibility['eligible']) continue;

            $distance = null;
            if (! $isNationwide) {
                if ($profile->base_location_lat === null || $profile->base_location_lng === null) {
                    continue;
                }
                $distance = $this->haversineKm($lat, $lng, $profile->base_location_lat, $profile->base_location_lng);

                $providerRadius = $profile->service_radius_km ?? $profile->max_radius_km ?? 50;
                $effectiveMax   = min($maxRingRadius, $providerRadius);

                if ($distance > $effectiveMax) continue;
            } else {
                if ($profile->base_location_lat !== null && $profile->base_location_lng !== null) {
                    $distance = $this->haversineKm($lat, $lng, $profile->base_location_lat, $profile->base_location_lng);
                } else {
                    $distance = 0;
                }
            }

            $slots = $this->availability->slotsForProvider($providerId, $date);
            if ($slots->isEmpty()) continue;

            // Provider must be available at the requested start time
            $fits = false;
            foreach ($slots as $slot) {
                $slotStart = substr($slot['start'], 0, 5);
                $slotEnd   = substr($slot['end'], 0, 5);
                if ($startTime >= $slotStart && $startTime < $slotEnd) {
                    $fits = true;
                    break;
                }
            }
            if (! $fits) continue;

            $overlap = DB::selectOne("
                SELECT id FROM bookings
                WHERE provider_id = ?
                  AND status IN ('FUNDS_HELD', 'IN_PROGRESS', 'REQUESTED', 'ACCEPTED')
                  AND scheduled_start < ?::timestamptz
                  AND scheduled_end   > ?::timestamptz
                LIMIT 1
            ", [$providerId, $scheduledEnd, $scheduledStart]);
            if ($overlap) continue;

            $candidates->push([
                'provider_id' => $providerId,
                'name'        => $ps->provider->legal_name ?? $ps->provider->email ?? 'Provider',
                'price'       => (float) ($ps->price ?? $ps->service?->base_price ?? 0),
                'distance_km' => $distance ?? 0,
                'tier'        => $profile->trust_tier,
            ]);
        }

        return $candidates;
    }

    private function trustScore(string $providerId): float
    {
        if ($this->trust instanceof RealTrustEngine) {
            return $this->trust->compositeScore($providerId);
        }

        $signal = TrustSignal::find($providerId);
        return $signal?->composite_score ?? 50;
    }

    // ── Fairness floor ──────────────────────────────────────────────────────

    private function applyFairnessFloor(
        \Illuminate\Support\Collection $scored,
        float $fairnessShare,
        int $shortlistSize,
    ): \Illuminate\Support\Collection {
        $probationJobs = config('dispatch.fairness.probation_jobs', 10);

        $newProviders = $scored->filter(function (array $item) use ($probationJobs) {
            $signal = TrustSignal::find($item['provider_id']);
            return ! $signal || $signal->rating_count < $probationJobs;
        });

        if ($newProviders->isEmpty()) return $scored;

        $reservedSlots = max(1, (int) ceil($shortlistSize * $fairnessShare));

        $established = $scored->reject(function (array $item) use ($probationJobs) {
            $signal = TrustSignal::find($item['provider_id']);
            return ! $signal || $signal->rating_count < $probationJobs;
        })->sortByDesc('score')->values();

        $newSorted = $newProviders->sortByDesc('score')->take($reservedSlots)->values();

        $establishedSlots = $shortlistSize - $newSorted->count();
        $merged = $established->take($establishedSlots)->merge($newSorted);

        return $merged->sortByDesc('score')->values();
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
