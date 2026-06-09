<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * v3.1 §4.2 — ride-hailing-style address book ("Home", "Work", ...).
 * Exactly one row per user has is_primary = true, mirroring users.primary_location.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('saved_locations', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('user_id');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->string('label');
            $table->string('place_name');
            $table->decimal('lat', 10, 8);
            $table->decimal('lng', 11, 8);
            $table->string('region')->nullable();
            $table->boolean('is_primary')->default(false);
            $table->timestampTz('created_at')->useCurrent();
        });

        DB::statement('CREATE INDEX idx_saved_locations_user ON saved_locations USING btree (user_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('saved_locations');
    }
};
