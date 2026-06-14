<?php

namespace App\Services\Location\Drivers;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Nominatim (OpenStreetMap) — the reverse-geocoding workhorse (v3.2 §3.1):
 * reverse lookups run on every GPS flow and need only neighborhood-level
 * labels, where OSM's Zambia coverage is adequate and the price is zero.
 * Also serves as the keyless forward fallback when no Google key is set.
 */
class NominatimDriver implements ForwardGeocoder, ReverseGeocoder
{
    private const USER_AGENT = 'SebenzaApp/1.0 (geocoding)';

    public function search(string $query, int $limit = 5, ?string $sessionToken = null): array
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
            ->map(fn (array $r) => $this->candidate($r, (float) $r['lat'], (float) $r['lon']))
            ->values()
            ->all();
    }

    public function reverse(float $lat, float $lng): ?array
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

        return $this->candidate($json, $lat, $lng);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function candidate(array $r, float $lat, float $lng): array
    {
        $address = $r['address'] ?? [];

        return [
            'label'           => $this->shortenLabel($r['display_name'] ?? ''),
            'place_name'      => $r['display_name'] ?? '',
            // v3.2 §3.4 — region at two levels: province for tax/reporting,
            // ward/township for analytics and promoted-slot geography.
            'region_province' => $address['state'] ?? $address['region'] ?? $address['county'] ?? $address['city'] ?? null,
            'region_ward'     => $address['suburb'] ?? $address['neighbourhood'] ?? $address['city_district']
                              ?? $address['village'] ?? $address['town'] ?? null,
            'lat'             => $lat,
            'lng'             => $lng,
        ];
    }

    private function get(string $path, array $params): array|null
    {
        $baseUrl = rtrim((string) config('location.geocoding.nominatim.base_url'), '/');

        try {
            $response = Http::withHeaders(['User-Agent' => self::USER_AGENT])
                ->timeout(8)
                ->get($baseUrl . $path, $params);

            return $response->successful() ? $response->json() : null;
        } catch (\Throwable $e) {
            Log::warning('NominatimDriver: request failed', ['path' => $path, 'error' => $e->getMessage()]);
            return null;
        }
    }

    /** Collapse Nominatim's long display_name into the short "{place}, {area}" the UI shows. */
    private function shortenLabel(string $displayName): string
    {
        $parts = array_filter(array_map('trim', explode(',', $displayName)));

        return implode(', ', array_slice(array_values($parts), 0, 2));
    }
}
