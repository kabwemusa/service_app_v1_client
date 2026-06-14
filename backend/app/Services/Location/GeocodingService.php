<?php

namespace App\Services\Location;

use App\Services\Location\Drivers\ForwardGeocoder;
use App\Services\Location\Drivers\GooglePlacesDriver;
use App\Services\Location\Drivers\NominatimDriver;
use App\Services\Location\Drivers\ReverseGeocoder;
use App\Support\Geohash;
use Illuminate\Support\Facades\Cache;

/**
 * v3.2 §3.1–3.2 — geocoding orchestrator.
 *
 * Hybrid strategy, driver per operation via config:
 *  - forward autocomplete: Google Places (POI/landmark coverage) or Nominatim
 *  - reverse:              Nominatim (high volume, label-level accuracy)
 *
 * Reverse results cache by geohash-6 cell (≈1.2 km × 0.6 km — neighborhood
 * granularity) for 30 days; the external geocoder is NEVER called on a cache
 * hit. Forward results are preceded by gazetteer matches (≥3 confirmations) —
 * our own data outranks the external provider's.
 */
class GeocodingService
{
    public function __construct(private readonly GazetteerService $gazetteer) {}

    /**
     * Typed query → ranked candidates: gazetteer first, then the external
     * driver (deduplicated by label).
     */
    public function search(string $query, int $limit = 5, ?string $sessionToken = null): array
    {
        $own      = $this->gazetteer->matches($query, $limit);
        $external = $this->forwardDriver()->search($query, $limit, $sessionToken);

        $seen   = array_map(fn ($c) => mb_strtolower($c['label']), $own);
        $merged = $own;

        foreach ($external as $candidate) {
            if (count($merged) >= $limit + count($own)) {
                break;
            }
            if (! in_array(mb_strtolower($candidate['label']), $seen, true)) {
                $merged[] = $candidate + ['gazetteer' => false];
            }
        }

        return $merged;
    }

    /**
     * GPS fix → neighborhood label, geohash-6 cached (30 days).
     * The exact coordinates passed in are preserved on the result — only the
     * LABEL is cell-level, which is all the UI ever shows.
     */
    public function reverseGeocode(float $lat, float $lng): ?array
    {
        $geohash6 = Geohash::encode($lat, $lng, 6);
        $cacheKey = "geo:{$geohash6}";

        $cached = Cache::get($cacheKey);

        if (is_array($cached)) {
            return $cached + ['lat' => $lat, 'lng' => $lng];
        }

        $result = $this->reverseDriver()->reverse($lat, $lng);

        if ($result === null) {
            return null;
        }

        Cache::put($cacheKey, [
            'label'           => $result['label'],
            'place_name'      => $result['place_name'],
            'region_province' => $result['region_province'],
            'region_ward'     => $result['region_ward'],
        ], now()->addDays((int) config('location.geocoding.reverse_cache_ttl_days', 30)));

        return $result;
    }

    // ── Driver selection (config, per operation) ─────────────────────────────

    private function forwardDriver(): ForwardGeocoder
    {
        return match (config('location.geocoding.forward', 'nominatim')) {
            'google' => app(GooglePlacesDriver::class),
            default  => app(NominatimDriver::class),
        };
    }

    private function reverseDriver(): ReverseGeocoder
    {
        // Only Nominatim implements reverse today; the match keeps the seam
        // explicit for a future driver.
        return match (config('location.geocoding.reverse', 'nominatim')) {
            default => app(NominatimDriver::class),
        };
    }
}
