<?php

namespace App\Services\Location;

use App\Services\Location\Drivers\ForwardGeocoder;
use App\Services\Location\Drivers\GooglePlacesDriver;
use App\Services\Location\Drivers\NominatimDriver;
use App\Services\Location\Drivers\PhotonDriver;
use App\Services\Location\Drivers\ReverseGeocoder;
use App\Support\Geohash;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * v3.2 §3.1–3.2 — geocoding orchestrator.
 *
 * Layered policy lives HERE, not in any single driver (Workstream C):
 *
 *  Forward:  gazetteer (our own confirmed place index — the authority for
 *            Zambian compounds/markets) → photon (self-hosted, Zambia-tuned) →
 *            google (cost-bounding last resort). Gazetteer matches always rank
 *            on top; the external chain is first-non-empty-wins.
 *  Reverse:  the configured primary (photon or nominatim), then SNAP the
 *            resulting region/ward against the gazetteer so internal region
 *            mapping stays consistent with the matching pipeline's geo rings.
 *
 * The driver order is config-expressible (`forward_chain`, `driver`) so photon
 * can be enabled per environment with no code change, and turned off to fall
 * back cleanly. Reverse results cache by geohash-6 cell (≈1.2 km × 0.6 km) for
 * 30 days; the external geocoder is NEVER called on a cache hit. Every request
 * logs which source answered, for later relevance tuning.
 */
class GeocodingService
{
    public function __construct(private readonly GazetteerService $gazetteer) {}

    /**
     * Typed query → ranked candidates. Gazetteer first (and ranked on top);
     * then the configured forward chain, first driver with results wins.
     *
     * @param  array{lat: float, lng: float}|null $bias Optional device-coord hint.
     */
    public function search(string $query, int $limit = 5, ?string $sessionToken = null, ?array $bias = null): array
    {
        // 1. Gazetteer — our own authority for local place names.
        $own = array_map(
            fn (array $c) => $c + ['source' => 'gazetteer'],
            $this->gazetteer->matches($query, $limit),
        );

        // Optional, config-gated query-rewrite hook (off by default): a
        // gazetteer entry may normalise the query before downstream lookup.
        if (config('location.geocoding.gazetteer_query_rewrite', false)) {
            $rewritten = $this->gazetteer->rewriteQuery($query);
            if ($rewritten !== null) {
                $query = $rewritten;
            }
        }

        // On a confident gazetteer match, optionally short-circuit the external
        // chain entirely (off by default — preserves the gazetteer+external blend).
        if ($own !== [] && config('location.geocoding.gazetteer_short_circuit', false)) {
            Log::debug('geocode.search answered', ['source' => 'gazetteer', 'short_circuit' => true]);
            return array_slice($own, 0, $limit);
        }

        // 2/3. External chain (photon → google, or [forward]) — first non-empty wins.
        $seen   = array_map(fn ($c) => mb_strtolower($c['label']), $own);
        $merged = $own;

        foreach ($this->forwardChain() as $name) {
            $driver = $this->forwardDriver($name);
            if ($driver === null) {
                continue;
            }

            $results = $driver->search($query, $limit, $sessionToken, $bias);
            if ($results === []) {
                continue; // fall through to the next driver in the chain
            }

            Log::debug('geocode.search answered', ['source' => $name, 'count' => count($results)]);

            foreach ($results as $candidate) {
                if (count($merged) >= $limit + count($own)) {
                    break;
                }
                if (! in_array(mb_strtolower($candidate['label']), $seen, true)) {
                    $merged[] = $candidate + ['gazetteer' => false, 'source' => $name];
                }
            }

            break; // a driver answered — don't also bill the fallback
        }

        return $merged;
    }

    /**
     * GPS fix → neighborhood label, geohash-6 cached (30 days). The exact
     * coordinates passed in are preserved on the result — only the LABEL is
     * cell-level, which is all the UI ever shows. The region/ward is snapped to
     * the gazetteer's canonical value for the cell when we have one.
     */
    public function reverseGeocode(float $lat, float $lng): ?array
    {
        $geohash6 = Geohash::encode($lat, $lng, 6);
        $cacheKey = "geo:{$geohash6}";

        $cached = Cache::get($cacheKey);

        if (is_array($cached)) {
            return $cached + ['lat' => $lat, 'lng' => $lng];
        }

        [$name, $driver] = $this->reverseDriver();
        $result = $driver->reverse($lat, $lng);

        if ($result === null) {
            return null;
        }

        // Snap region/ward to the gazetteer's canonical value for this cell so
        // internal regions stay consistent with the matching pipeline (§3.1).
        if (config('location.geocoding.reverse_snap', true)) {
            $snap = $this->gazetteer->regionFor($lat, $lng);
            if ($snap !== null) {
                $result['region_province'] = $snap['region_province'] ?? $result['region_province'];
                $result['region_ward']     = $snap['region_ward'] ?? $result['region_ward'];
            }
        }

        Log::debug('geocode.reverse answered', ['source' => $name]);

        Cache::put($cacheKey, [
            'label'           => $result['label'],
            'place_name'      => $result['place_name'],
            'region_province' => $result['region_province'],
            'region_city'     => $result['region_city'] ?? null,
            'region_ward'     => $result['region_ward'],
        ], now()->addDays((int) config('location.geocoding.reverse_cache_ttl_days', 30)));

        return $result;
    }

    // ── Driver selection (config-expressible) ────────────────────────────────

    /**
     * Ordered forward chain tried after the gazetteer. Explicit
     * `forward_chain` wins; otherwise derived from the `driver` feature flag.
     *
     * @return array<int, string>
     */
    private function forwardChain(): array
    {
        $chain = (array) config('location.geocoding.forward_chain', []);
        if ($chain !== []) {
            return $chain;
        }

        return match (config('location.geocoding.driver')) {
            'photon' => ['photon', 'google'],
            default  => [(string) config('location.geocoding.forward', 'nominatim')],
        };
    }

    private function forwardDriver(string $name): ?ForwardGeocoder
    {
        return match ($name) {
            'photon'    => app(PhotonDriver::class),
            'google'    => app(GooglePlacesDriver::class),
            'nominatim' => app(NominatimDriver::class),
            default     => null,
        };
    }

    /** @return array{0: string, 1: ReverseGeocoder} [source name, driver] */
    private function reverseDriver(): array
    {
        $name = config('location.geocoding.driver') === 'photon'
            ? 'photon'
            : (string) config('location.geocoding.reverse', 'nominatim');

        return match ($name) {
            'photon' => ['photon', app(PhotonDriver::class)],
            default  => ['nominatim', app(NominatimDriver::class)],
        };
    }
}
