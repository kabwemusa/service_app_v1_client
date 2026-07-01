<?php

namespace App\Services\Location\Drivers;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Photon (self-hosted, OpenStreetMap-derived) — v3.2 §3.1.
 *
 * A Komoot-Photon instance imported and filtered to Zambia. Every request is
 * constrained and biased to Zambia at the query level (Workstream B):
 *  - bbox hard-restricts results to the country extent,
 *  - a proximity bias (device coords, else Lusaka centre) ranks nearby first,
 *  - a layer filter drops house-level noise the label UI never shows.
 *
 * The instance is reached over HTTP at a configurable base URL; on any
 * error / timeout / empty response it returns the no-result outcome ([] / null)
 * so {@see \App\Services\Location\GeocodingService} can fall through to Google —
 * it NEVER throws, matching the other drivers' semantics.
 *
 * Photon returns GeoJSON: `geometry.coordinates` is [lon, lat] (GeoJSON order),
 * which is normalised explicitly to {lat, lng} — the single most likely bug.
 */
class PhotonDriver implements ForwardGeocoder, ReverseGeocoder
{
    /** Forward: GET {base}/api — typed query → ranked candidates. */
    public function search(string $query, int $limit = 5, ?string $sessionToken = null, ?array $bias = null): array
    {
        $query = trim($query);
        if ($query === '') {
            return [];
        }

        $cfg   = $this->config();
        $limit = $limit > 0 ? min($limit, $cfg['limit']) : $cfg['limit'];

        // Proximity bias: device coords when supplied, else the configured
        // fallback centre (Lusaka). Constrains relevance without a hard filter.
        $biasLat = $bias['lat'] ?? $cfg['fallback_lat'];
        $biasLon = $bias['lng'] ?? $cfg['fallback_lon'];

        $params = [
            'q'                   => $query,
            'lang'                => $cfg['lang'],
            'limit'               => $limit,
            'bbox'                => $cfg['bbox'],
            'lat'                 => $biasLat,
            'lon'                 => $biasLon,
            'location_bias_scale' => $cfg['bias_scale'],
            'zoom'                => $cfg['zoom'],
            // Repeated key per layer: layer=city&layer=street (Workstream B).
            'layer'               => $cfg['layers'],
        ];

        $json = $this->get('/api', $params);

        return $this->parseFeatureCollection($json, $limit);
    }

    /** Reverse: GET {base}/reverse — coord → nearest label. */
    public function reverse(float $lat, float $lng): ?array
    {
        $cfg = $this->config();

        $json = $this->get('/reverse', [
            'lat'    => $lat,
            'lon'    => $lng,
            'lang'   => $cfg['lang'],
            'limit'  => 1,
            // Bound the search so thin-coverage lookups don't snap far away.
            'radius' => $cfg['reverse_radius_km'],
        ]);

        $candidates = $this->parseFeatureCollection($json, 1);

        // Reverse preserves the EXACT coordinates queried; only the label is
        // feature-derived (mirrors NominatimDriver / the product promise).
        if ($candidates === []) {
            return null;
        }

        return ['lat' => $lat, 'lng' => $lng] + $candidates[0];
    }

    // ── Parsing ──────────────────────────────────────────────────────────────

    /**
     * GeoJSON FeatureCollection → normalised candidates.
     *
     * @return array<int, array{label: string, place_name: string, region_province: ?string, region_ward: ?string, lat: float, lng: float}>
     */
    private function parseFeatureCollection(?array $json, int $limit): array
    {
        $features = $json['features'] ?? null;
        if (! is_array($features)) {
            return [];
        }

        $out = [];
        foreach ($features as $feature) {
            $coords = $feature['geometry']['coordinates'] ?? null;

            // GeoJSON order is [lon, lat] — normalise explicitly. Anything
            // shorter than a pair is unusable.
            if (! is_array($coords) || count($coords) < 2
                || ! is_numeric($coords[0]) || ! is_numeric($coords[1])) {
                continue;
            }

            $lon = (float) $coords[0];
            $lat = (float) $coords[1];

            $out[] = $this->candidate((array) ($feature['properties'] ?? []), $lat, $lon);

            if (count($out) >= $limit) {
                break;
            }
        }

        return $out;
    }

    /** Photon feature properties → the shared candidate shape. */
    private function candidate(array $props, float $lat, float $lon): array
    {
        $name = $this->str($props['name'] ?? '') ?: $this->str($props['street'] ?? '');

        // v3.2 §3.4 — province for tax/reporting, city/town + ward/township for
        // the geo-widening tiers (area → city → province).
        $province = $this->firstOf($props, ['state', 'county', 'city']);
        $city     = $this->firstOf($props, ['city', 'town', 'district']);
        $ward     = $this->firstOf($props, ['suburb', 'locality', 'neighbourhood', 'district', 'city']);

        // Short "{place}, {area}" the UI shows — first two non-empty parts,
        // mirroring NominatimDriver::shortenLabel.
        $label = implode(', ', array_slice(array_values(array_filter([
            $name,
            $this->firstOf($props, ['city', 'district', 'locality']),
            $this->str($props['state'] ?? ''),
        ])), 0, 2));

        // Full address line for place_name (Google's formatted_address analogue).
        $placeName = implode(', ', array_filter([
            $name,
            $this->str($props['street'] ?? ''),
            $this->str($props['city'] ?? ''),
            $this->str($props['state'] ?? ''),
            $this->str($props['country'] ?? ''),
        ]));

        return [
            'label'           => $label !== '' ? $label : ($placeName !== '' ? $placeName : 'Unknown place'),
            'place_name'      => $placeName !== '' ? $placeName : $label,
            'region_province' => $province,
            'region_city'     => $city,
            'region_ward'     => $ward,
            'lat'             => $lat,
            'lng'             => $lon,
        ];
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function get(string $path, array $params): ?array
    {
        $cfg = $this->config();
        $url = rtrim($cfg['base_url'], '/') . $path . '?' . $this->buildQuery($params);

        try {
            $response = Http::timeout($cfg['timeout'])->get($url);

            return $response->successful() ? (array) $response->json() : null;
        } catch (\Throwable $e) {
            Log::warning('PhotonDriver: request failed', ['path' => $path, 'error' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * Build a query string with repeated keys for array values
     * (layer=city&layer=street) — http_build_query would emit layer[]=…,
     * which Photon does not parse.
     */
    private function buildQuery(array $params): string
    {
        $pairs = [];

        foreach ($params as $key => $value) {
            if ($value === null || $value === '' || $value === []) {
                continue;
            }

            foreach ((array) $value as $item) {
                $pairs[] = rawurlencode((string) $key) . '=' . rawurlencode((string) $item);
            }
        }

        return implode('&', $pairs);
    }

    /** First non-empty string among the given property keys, or null. */
    private function firstOf(array $props, array $keys): ?string
    {
        foreach ($keys as $key) {
            $value = $this->str($props[$key] ?? '');
            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    private function str(mixed $value): string
    {
        return is_scalar($value) ? trim((string) $value) : '';
    }

    /** @return array<string, mixed> */
    private function config(): array
    {
        $photon = (array) config('location.geocoding.photon', []);

        return [
            'base_url'          => (string) ($photon['base_url'] ?? 'http://localhost:2322'),
            'bbox'              => (string) ($photon['bbox'] ?? '21.99,-18.08,33.71,-8.22'),
            'lang'              => (string) ($photon['lang'] ?? 'en'),
            'limit'             => (int) ($photon['limit'] ?? 5),
            'timeout'           => (int) ($photon['timeout'] ?? 5),
            'bias_scale'        => (float) ($photon['bias_scale'] ?? 0.7),
            'zoom'              => $photon['zoom'] ?? null,
            'fallback_lat'      => (float) ($photon['fallback_lat'] ?? -15.4167),
            'fallback_lon'      => (float) ($photon['fallback_lon'] ?? 28.2833),
            'layers'            => (array) ($photon['layers'] ?? ['city', 'locality', 'district', 'street', 'house']),
            'reverse_radius_km' => (float) ($photon['reverse_radius_km'] ?? 3),
        ];
    }
}
