<?php

namespace App\Services\Location;

/**
 * Coordinates → structured region hierarchy {ward, city, province}.
 *
 * The single source of truth for the geo-widening tiers (search widens
 * area → city → province → national). Resolution rides the geohash-6 reverse
 * cache in {@see GeocodingService}, so repeated lookups in a cell are free and
 * the external geocoder is hit at most once per neighbourhood per 30 days.
 *
 * Names are normalised (trimmed, empty → null) so equality comparisons in the
 * search widening are stable.
 */
class RegionResolver
{
    public function __construct(private readonly GeocodingService $geocoding) {}

    /**
     * @return array{ward: ?string, city: ?string, province: ?string}
     */
    public function resolve(?float $lat, ?float $lng): array
    {
        if ($lat === null || $lng === null) {
            return ['ward' => null, 'city' => null, 'province' => null];
        }

        $result = $this->geocoding->reverseGeocode($lat, $lng);

        if ($result === null) {
            return ['ward' => null, 'city' => null, 'province' => null];
        }

        return [
            'ward'     => $this->clean($result['region_ward'] ?? null),
            'city'     => $this->clean($result['region_city'] ?? null),
            'province' => $this->clean($result['region_province'] ?? null),
        ];
    }

    private function clean(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim($value);

        return $value === '' ? null : $value;
    }
}
