<?php

namespace App\Support;

/**
 * Minimal geohash codec (standard base-32 alphabet).
 *
 * Precision 6 ≈ 1.2 km × 0.6 km — the right cell size for a neighborhood
 * label (v3.2 §3.2); precision 5 ≈ 4.9 km × 4.9 km — used for the search
 * impressions log (§7).
 */
final class Geohash
{
    private const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

    public static function encode(float $lat, float $lng, int $precision = 6): string
    {
        $latRange = [-90.0, 90.0];
        $lngRange = [-180.0, 180.0];

        $hash   = '';
        $bits   = 0;
        $char   = 0;
        $isLng  = true;

        while (strlen($hash) < $precision) {
            if ($isLng) {
                $mid = ($lngRange[0] + $lngRange[1]) / 2;
                if ($lng >= $mid) {
                    $char = ($char << 1) | 1;
                    $lngRange[0] = $mid;
                } else {
                    $char <<= 1;
                    $lngRange[1] = $mid;
                }
            } else {
                $mid = ($latRange[0] + $latRange[1]) / 2;
                if ($lat >= $mid) {
                    $char = ($char << 1) | 1;
                    $latRange[0] = $mid;
                } else {
                    $char <<= 1;
                    $latRange[1] = $mid;
                }
            }

            $isLng = ! $isLng;

            if (++$bits === 5) {
                $hash .= self::BASE32[$char];
                $bits = 0;
                $char = 0;
            }
        }

        return $hash;
    }

    /**
     * Decode a geohash to its cell-centroid coordinates.
     *
     * @return array{lat: float, lng: float}
     */
    public static function decode(string $geohash): array
    {
        $latRange = [-90.0, 90.0];
        $lngRange = [-180.0, 180.0];
        $isLng    = true;

        foreach (str_split(strtolower($geohash)) as $chr) {
            $index = strpos(self::BASE32, $chr);
            if ($index === false) {
                continue;
            }

            for ($bit = 4; $bit >= 0; $bit--) {
                $set = ($index >> $bit) & 1;

                if ($isLng) {
                    $mid = ($lngRange[0] + $lngRange[1]) / 2;
                    $set ? $lngRange[0] = $mid : $lngRange[1] = $mid;
                } else {
                    $mid = ($latRange[0] + $latRange[1]) / 2;
                    $set ? $latRange[0] = $mid : $latRange[1] = $mid;
                }

                $isLng = ! $isLng;
            }
        }

        return [
            'lat' => ($latRange[0] + $latRange[1]) / 2,
            'lng' => ($lngRange[0] + $lngRange[1]) / 2,
        ];
    }
}
