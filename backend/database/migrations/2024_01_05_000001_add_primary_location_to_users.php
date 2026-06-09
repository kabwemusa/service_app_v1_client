<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * v3.1 §4.2 — every user has a primary location captured once at onboarding.
 * Coordinates are internal only; `label`/`region` are what the UI ever shows.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->decimal('primary_location_lat', 10, 8)->nullable()->after('last_active_at');
            $table->decimal('primary_location_lng', 11, 8)->nullable()->after('primary_location_lat');
            $table->string('primary_location_label')->nullable()->after('primary_location_lng');
            $table->string('primary_location_region')->nullable()->after('primary_location_label');
            $table->string('primary_location_source', 10)->nullable()->after('primary_location_region');
        });

        DB::statement("ALTER TABLE users ADD CONSTRAINT users_primary_location_source_check CHECK (primary_location_source IN ('DEVICE','SEARCH') OR primary_location_source IS NULL)");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_primary_location_source_check');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'primary_location_lat',
                'primary_location_lng',
                'primary_location_label',
                'primary_location_region',
                'primary_location_source',
            ]);
        });
    }
};
