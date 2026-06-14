<?php

namespace App\Services\Location\Drivers;

/**
 * Reverse geocoding (GPS fix → neighborhood label) — v3.2 §3.1.
 */
interface ReverseGeocoder
{
    /**
     * @return array{label: string, place_name: string, region_province: ?string, region_ward: ?string, lat: float, lng: float}|null
     */
    public function reverse(float $lat, float $lng): ?array;
}
