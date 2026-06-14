<?php

namespace App\Services\Location;

use App\Support\Geohash;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * v3.2 §3.1 — gazetteer capture and lookup.
 *
 * Capture: every confirmed label upserts a (geohash6, label) row, incrementing
 * confirm_count on repeat confirmation. Lookup: entries confirmed ≥ 3 times
 * are served as autocomplete candidates ranked above external results.
 */
class GazetteerService
{
    public const SOURCE_CONFIRMED_REVERSE = 'CONFIRMED_REVERSE';
    public const SOURCE_SAVED_LOCATION    = 'SAVED_LOCATION';
    public const SOURCE_SEARCH_PICK       = 'SEARCH_PICK';

    /** Upsert one confirmation. Never throws — capture must not break the flow it rides on. */
    public function record(
        float   $lat,
        float   $lng,
        string  $label,
        ?string $regionProvince,
        ?string $regionWard,
        string  $source,
    ): void {
        $label = trim($label);
        if ($label === '') {
            return;
        }

        try {
            DB::statement("
                INSERT INTO gazetteer_entries (geohash6, label, region_province, region_ward, source, confirm_count)
                VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT (geohash6, label)
                DO UPDATE SET confirm_count   = gazetteer_entries.confirm_count + 1,
                              region_province = COALESCE(gazetteer_entries.region_province, EXCLUDED.region_province),
                              region_ward     = COALESCE(gazetteer_entries.region_ward, EXCLUDED.region_ward)
            ", [
                Geohash::encode($lat, $lng, 6),
                mb_substr($label, 0, 120),
                $regionProvince,
                $regionWard,
                $source,
            ]);
        } catch (\Throwable $e) {
            Log::warning('GazetteerService::record failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Autocomplete candidates from the gazetteer (confirm_count ≥ 3),
     * strongest confirmations first. Coordinates are the geohash6 cell
     * centroid — neighborhood-level, which is exactly the product promise.
     *
     * @return array<int, array{label: string, place_name: string, region_province: ?string, region_ward: ?string, lat: float, lng: float, gazetteer: bool}>
     */
    public function matches(string $query, int $limit = 5): array
    {
        $query = trim($query);
        if (mb_strlen($query) < 2) {
            return [];
        }

        $minConfirms = (int) config('location.geocoding.gazetteer_min_confirms', 3);

        try {
            $rows = DB::select("
                SELECT geohash6, label, region_province, region_ward, confirm_count
                FROM   gazetteer_entries
                WHERE  confirm_count >= ?
                  AND  lower(label) LIKE lower(?)
                ORDER  BY confirm_count DESC, label
                LIMIT  {$limit}
            ", [$minConfirms, '%' . addcslashes($query, '%_\\') . '%']);
        } catch (\Throwable $e) {
            Log::warning('GazetteerService::matches failed', ['error' => $e->getMessage()]);
            return [];
        }

        return array_map(function ($row) {
            $centroid = Geohash::decode($row->geohash6);

            return [
                'label'           => $row->label,
                'place_name'      => $row->label,
                'region_province' => $row->region_province,
                'region_ward'     => $row->region_ward,
                'lat'             => round($centroid['lat'], 6),
                'lng'             => round($centroid['lng'], 6),
                'gazetteer'       => true,
            ];
        }, $rows);
    }
}
