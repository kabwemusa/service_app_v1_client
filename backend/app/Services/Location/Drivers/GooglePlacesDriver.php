<?php

namespace App\Services\Location\Drivers;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Google Places — forward autocomplete only (v3.2 §3.1).
 *
 * Chosen for coverage of Lusaka POIs, malls, churches, and informal landmark
 * names — landmark search is the primary addressing mode in Zambia. Session
 * tokens bound autocomplete billing per completed search: pass the SAME token
 * for every keystroke of one user search; the Place Details call that resolves
 * the picked candidate closes the session.
 *
 * Reverse geocoding deliberately stays on Nominatim (high volume, label-level
 * accuracy is enough, and this is where Google cost would explode).
 */
class GooglePlacesDriver implements ForwardGeocoder
{
    private const AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
    private const DETAILS_URL      = 'https://maps.googleapis.com/maps/api/place/details/json';

    public function search(string $query, int $limit = 5, ?string $sessionToken = null, ?array $bias = null): array
    {
        // $bias is accepted for interface conformance; Places autocomplete does
        // its own session-scoped relevance, so we don't forward device coords.
        $query = trim($query);
        $key   = (string) config('location.geocoding.google.key');

        if ($query === '' || $key === '') {
            return [];
        }

        $json = $this->get(self::AUTOCOMPLETE_URL, array_filter([
            'input'        => $query,
            'components'   => 'country:zm',
            'sessiontoken' => $sessionToken,
            'key'          => $key,
        ]));

        $predictions = array_slice((array) ($json['predictions'] ?? []), 0, $limit);

        $candidates = [];
        foreach ($predictions as $prediction) {
            if (empty($prediction['place_id'])) {
                continue;
            }

            $details = $this->placeDetails((string) $prediction['place_id'], $key, $sessionToken);
            if ($details !== null) {
                $candidates[] = $details;
            }
        }

        return $candidates;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function placeDetails(string $placeId, string $key, ?string $sessionToken): ?array
    {
        $json = $this->get(self::DETAILS_URL, array_filter([
            'place_id'     => $placeId,
            'fields'       => 'name,formatted_address,geometry,address_components',
            'sessiontoken' => $sessionToken,
            'key'          => $key,
        ]));

        $result   = $json['result'] ?? null;
        $location = $result['geometry']['location'] ?? null;

        if (! $result || ! isset($location['lat'], $location['lng'])) {
            return null;
        }

        [$province, $city, $ward] = $this->extractRegions((array) ($result['address_components'] ?? []));

        $name    = (string) ($result['name'] ?? '');
        $address = (string) ($result['formatted_address'] ?? '');

        return [
            'label'           => $name !== '' && $ward !== null ? "{$name}, {$ward}" : ($name !== '' ? $name : $address),
            'place_name'      => $address !== '' ? $address : $name,
            'region_province' => $province,
            'region_city'     => $city,
            'region_ward'     => $ward,
            'lat'             => (float) $location['lat'],
            'lng'             => (float) $location['lng'],
        ];
    }

    /** @return array{0: ?string, 1: ?string, 2: ?string} [province, city, ward] */
    private function extractRegions(array $components): array
    {
        $province = null;
        $city     = null;
        $ward     = null;

        foreach ($components as $component) {
            $types = (array) ($component['types'] ?? []);
            $name  = $component['long_name'] ?? null;

            if (in_array('administrative_area_level_1', $types, true)) {
                $province ??= $name;
            }
            // city/town tier — locality, else the district (admin level 2)
            if (in_array('locality', $types, true)
                || in_array('postal_town', $types, true)
                || in_array('administrative_area_level_2', $types, true)) {
                $city ??= $name;
            }
            if (in_array('sublocality', $types, true)
                || in_array('sublocality_level_1', $types, true)
                || in_array('neighborhood', $types, true)) {
                $ward ??= $name;
            }
        }

        return [$province, $city, $ward];
    }

    private function get(string $url, array $params): array
    {
        try {
            $response = Http::timeout(8)->get($url, $params);

            return $response->successful() ? (array) $response->json() : [];
        } catch (\Throwable $e) {
            Log::warning('GooglePlacesDriver: request failed', ['url' => $url, 'error' => $e->getMessage()]);
            return [];
        }
    }
}
