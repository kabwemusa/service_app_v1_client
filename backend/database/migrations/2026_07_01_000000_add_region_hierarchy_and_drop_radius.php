<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Geo-widening model (replaces the radius filter).
 *
 * Candidate geography is no longer a distance radius. Instead every provider and
 * service carries a structured region hierarchy — ward (area) → city (town) →
 * province — resolved from its base/service coordinates via the geocoder. Search
 * widens area → city → province → national and only reports "no one" once every
 * tier is exhausted. Distance survives purely as a soft ranking signal (§1.6),
 * never as a hard cut-off, so the radius columns are retired.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('provider_profiles', function (Blueprint $table) {
            $table->string('region_ward', 80)->nullable()->after('base_location_label');
            $table->string('region_city', 80)->nullable()->after('region_ward');
            $table->string('region_province', 60)->nullable()->after('region_city');
        });

        Schema::table('services', function (Blueprint $table) {
            $table->string('region_ward', 80)->nullable()->after('service_location');
            $table->string('region_city', 80)->nullable()->after('region_ward');
            $table->string('region_province', 60)->nullable()->after('region_city');
        });

        // Case-insensitive lookup indexes for the widening tiers.
        DB::statement('CREATE INDEX IF NOT EXISTS idx_svc_region_province ON services (lower(region_province))');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_svc_region_city     ON services (lower(region_city))');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_svc_region_ward     ON services (lower(region_ward))');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_pp_region_province  ON provider_profiles (lower(region_province))');

        // The radius filter is gone: service_radius_km / max_radius_km no longer
        // gate candidacy. Columns are kept (nullable/defaulted) to avoid breaking
        // the transition window; a later release can drop them once no code reads
        // them. Neutralise the onboarding default so nothing implies a 5 km cap.
        DB::statement('ALTER TABLE provider_profiles ALTER COLUMN max_radius_km DROP NOT NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_svc_region_province');
        DB::statement('DROP INDEX IF EXISTS idx_svc_region_city');
        DB::statement('DROP INDEX IF EXISTS idx_svc_region_ward');
        DB::statement('DROP INDEX IF EXISTS idx_pp_region_province');

        Schema::table('services', function (Blueprint $table) {
            $table->dropColumn(['region_ward', 'region_city', 'region_province']);
        });

        Schema::table('provider_profiles', function (Blueprint $table) {
            $table->dropColumn(['region_ward', 'region_city', 'region_province']);
        });
    }
};
