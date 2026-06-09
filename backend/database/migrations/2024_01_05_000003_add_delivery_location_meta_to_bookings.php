<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * v3.1 §4.2 — bookings carry a full delivery location { lat, lng, label, region }
 * plus provenance. The PostGIS point (delivery_location) already exists
 * (2024_01_01_000004); this adds the human-readable label/region/source the
 * provider sees on the request card (§6.8) — coordinates are never displayed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->string('delivery_location_label')->nullable()->after('dispute_reason');
            $table->string('delivery_location_region')->nullable()->after('delivery_location_label');
            $table->string('delivery_location_source', 10)->nullable()->after('delivery_location_region');
        });

        DB::statement("ALTER TABLE bookings ADD CONSTRAINT bookings_delivery_location_source_check CHECK (delivery_location_source IN ('DEVICE','SEARCH','SAVED') OR delivery_location_source IS NULL)");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_delivery_location_source_check');

        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn([
                'delivery_location_label',
                'delivery_location_region',
                'delivery_location_source',
            ]);
        });
    }
};
