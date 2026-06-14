<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * v3.2 §3.1 — the home-grown Zambia gazetteer.
 *
 * Every user-confirmed reverse-geocode label, saved location, and search pick
 * is a verified (geohash6 → label, region) pair. Entries with confirm_count
 * ≥ 3 are served as autocomplete candidates ranked ABOVE external results —
 * compounds, markets, and "near X church" names no commercial provider
 * covers. This is the moat, and it shrinks the Google bill over time.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('gazetteer_entries', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->string('geohash6', 6);
            $table->string('label', 120);
            $table->string('region_province', 60)->nullable();
            $table->string('region_ward', 80)->nullable();

            $table->string('source', 20);
            // CONFIRMED_REVERSE | SAVED_LOCATION | SEARCH_PICK

            $table->unsignedInteger('confirm_count')->default(1);
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['geohash6', 'label']);
        });

        DB::statement("ALTER TABLE gazetteer_entries ADD CONSTRAINT gazetteer_entries_source_check
            CHECK (source IN ('CONFIRMED_REVERSE', 'SAVED_LOCATION', 'SEARCH_PICK'))");

        DB::statement('CREATE INDEX idx_gazetteer_label ON gazetteer_entries USING btree (lower(label) text_pattern_ops)');
        DB::statement('CREATE INDEX idx_gazetteer_confirms ON gazetteer_entries USING btree (confirm_count DESC)');
    }

    public function down(): void
    {
        Schema::dropIfExists('gazetteer_entries');
    }
};
