<?php

namespace App\Console\Commands;

use App\Services\Location\RegionResolver;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * One-off backfill for the geo-widening model: resolve the region hierarchy
 * (ward → city → province) for every provider (from base_location) and every
 * service (from service_location) that has coordinates but no region yet.
 *
 * Uses the configured geocoder (Photon in production — see
 * PHOTON_GEOCODING_RUNBOOK.md). Reverse lookups are geohash-6 cached, so
 * providers/services clustered in the same neighbourhood share one external
 * call. Re-runnable; pass --force to re-resolve rows that already have a region.
 */
class BackfillRegionsCommand extends Command
{
    protected $signature = 'geo:backfill-regions {--force : Re-resolve rows that already have a region}';
    protected $description = 'Backfill provider/service region hierarchy (ward/city/province) from coordinates';

    public function handle(RegionResolver $resolver): int
    {
        $force = (bool) $this->option('force');

        $this->info('Backfilling provider_profiles…');
        $providers = $this->backfillProviders($resolver, $force);
        $this->info("  → {$providers} provider(s) updated.");

        $this->info('Backfilling services…');
        $services = $this->backfillServices($resolver, $force);
        $this->info("  → {$services} service(s) updated.");

        $this->info('Done.');

        return self::SUCCESS;
    }

    private function backfillProviders(RegionResolver $resolver, bool $force): int
    {
        $rows = DB::table('provider_profiles')
            ->select('user_id', 'base_location_lat', 'base_location_lng')
            ->whereNotNull('base_location_lat')
            ->whereNotNull('base_location_lng')
            ->when(! $force, fn ($q) => $q->whereNull('region_province'))
            ->get();

        $updated = 0;
        foreach ($rows as $row) {
            $region = $resolver->resolve((float) $row->base_location_lat, (float) $row->base_location_lng);
            if ($region['ward'] === null && $region['city'] === null && $region['province'] === null) {
                continue;
            }
            DB::table('provider_profiles')->where('user_id', $row->user_id)->update([
                'region_ward'     => $region['ward'],
                'region_city'     => $region['city'],
                'region_province' => $region['province'],
            ]);
            $updated++;
        }

        return $updated;
    }

    private function backfillServices(RegionResolver $resolver, bool $force): int
    {
        // service_location is a PostGIS geography — pull lat/lng out explicitly.
        $rows = DB::select('
            SELECT id,
                   ST_Y(service_location::geometry) AS lat,
                   ST_X(service_location::geometry) AS lng
            FROM   services
            WHERE  service_location IS NOT NULL
              ' . ($force ? '' : 'AND region_province IS NULL'));

        $updated = 0;
        foreach ($rows as $row) {
            if ($row->lat === null || $row->lng === null) {
                continue;
            }
            $region = $resolver->resolve((float) $row->lat, (float) $row->lng);
            if ($region['ward'] === null && $region['city'] === null && $region['province'] === null) {
                continue;
            }
            DB::update(
                'UPDATE services SET region_ward = ?, region_city = ?, region_province = ? WHERE id = ?',
                [$region['ward'], $region['city'], $region['province'], $row->id],
            );
            $updated++;
        }

        return $updated;
    }
}
