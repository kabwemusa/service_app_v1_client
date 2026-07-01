<?php

namespace App\Services\Location\Drivers;

/**
 * Forward geocoding (typed query → place candidates) — v3.2 §3.1.
 *
 * Every candidate is the array shape the UI consumes:
 * {label, place_name, region_province, region_ward, lat, lng}.
 * Coordinates never surface to the user — labels do (v3.1 §4.1).
 */
interface ForwardGeocoder
{
    /**
     * @param  string|null $sessionToken Autocomplete billing session (Google);
     *                                   drivers without sessions ignore it.
     * @param  array{lat: float, lng: float}|null $bias Device-coordinate
     *                                   relevance hint; drivers without a
     *                                   proximity-bias notion ignore it.
     * @return array<int, array{label: string, place_name: string, region_province: ?string, region_ward: ?string, lat: float, lng: float}>
     */
    public function search(string $query, int $limit = 5, ?string $sessionToken = null, ?array $bias = null): array;
}
