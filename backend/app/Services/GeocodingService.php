<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * v3.1 §4.3 — forward + reverse geocoding, the two operations PostGIS cannot do.
 *
 * Backed by Nominatim (OpenStreetMap): already integrated client-side and
 * needs no API key, resolving the §10.1 open product decision pragmatically.
 * Coordinates never leave this layer as a user-facing value — every result
 * carries the {label, region} pair the UI actually shows (v3.1 §4.1).
 */
class GeocodingService
{
    private const BASE_URL   = 'https://nominatim.openstreetmap.org';
    private const USER_AGENT = 'SebenzaApp/1.0 (geocoding)';

    /** Device GPS lat/lng → human label + region for onboarding/delivery confirmation. */
    public function reverseGeocode(float $lat, float $lng): ?array
    {
        $json = $this->get('/reverse', [
            'lat'            => $lat,
            'lon'            => $lng,
            'format'         => 'json',
            'addressdetails' => 1,
            'zoom'           => 16,
        ]);

        if (! $json || empty($json['display_name'])) {
            return null;
        }

        return [
            'label'      => $this->shortenLabel($json['display_name']),
            'place_name' => $json['display_name'],
            'region'     => $this->extractRegion($json['address'] ?? []),
            'lat'        => $lat,
            'lng'        => $lng,
        ];
    }

    /** Typed query → ranked place candidates for the autocomplete search field. */
    public function search(string $query, int $limit = 5): array
    {
        $query = trim($query);
        if ($query === '') {
            return [];
        }

        $json = $this->get('/search', [
            'q'              => $query,
            'format'         => 'json',
            'addressdetails' => 1,
            'limit'          => $limit,
            'countrycodes'   => 'zm',
        ]);

        if (! is_array($json)) {
            return [];
        }

        return collect($json)
            ->filter(fn ($r) => is_array($r) && isset($r['lat'], $r['lon']))
            ->map(fn (array $r) => [
                'label'      => $this->shortenLabel($r['display_name'] ?? ''),
                'place_name' => $r['display_name'] ?? '',
                'region'     => $this->extractRegion($r['address'] ?? []),
                'lat'        => (float) $r['lat'],
                'lng'        => (float) $r['lon'],
            ])
            ->values()
            ->all();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function get(string $path, array $params): array|null
    {
        try {
            $response = Http::withHeaders(['User-Agent' => self::USER_AGENT])
                ->timeout(8)
                ->get(self::BASE_URL . $path, $params);

            return $response->successful() ? $response->json() : null;
        } catch (\Throwable $e) {
            Log::warning('GeocodingService: request failed', ['path' => $path, 'error' => $e->getMessage()]);
            return null;
        }
    }

    /** Collapse Nominatim's long display_name into the short "{place}, {area}" the UI shows. */
    private function shortenLabel(string $displayName): string
    {
        $parts = array_filter(array_map('trim', explode(',', $displayName)));
        return implode(', ', array_slice(array_values($parts), 0, 2));
    }

    /** v3 §4.4 region parsing — province/state for tax & reporting, never shown raw to the user as coordinates. */
    private function extractRegion(array $address): ?string
    {
        return $address['state']
            ?? $address['region']
            ?? $address['county']
            ?? $address['city']
            ?? null;
    }
}
