<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * v3.1 §5.1 — services gains a real listing shape: pricing model, a
     * status lifecycle, a duration estimate, and highlight pinning. The old
     * boolean `is_active` is superseded by the richer `status` enum
     * (DRAFT/ACTIVE/PAUSED/HIDDEN); existing rows are backfilled 1:1
     * (true → ACTIVE, false → PAUSED) before the column is dropped.
     */
    public function up(): void
    {
        Schema::table('services', function (Blueprint $table) {
            $table->unsignedSmallInteger('duration_estimate_mins')->nullable()->after('base_price');
        });

        // FIXED/HOURLY require a price; QUOTE does not (§5.1).
        DB::statement('ALTER TABLE services ALTER COLUMN base_price DROP NOT NULL');

        DB::statement("ALTER TABLE services ADD COLUMN pricing_model VARCHAR(10) NOT NULL DEFAULT 'FIXED'");
        DB::statement("ALTER TABLE services ADD CONSTRAINT services_pricing_model_check
            CHECK (pricing_model IN ('FIXED','HOURLY','QUOTE'))");

        DB::statement("ALTER TABLE services ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'DRAFT'");
        DB::statement("UPDATE services SET status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'PAUSED' END");
        DB::statement("ALTER TABLE services ADD CONSTRAINT services_status_check
            CHECK (status IN ('DRAFT','ACTIVE','PAUSED','HIDDEN'))");

        DB::statement('ALTER TABLE services ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT false');

        Schema::table('services', function (Blueprint $table) {
            $table->dropColumn('is_active');
        });

        DB::statement('CREATE INDEX idx_services_provider_status ON services USING btree (provider_id, status)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_services_provider_status');

        Schema::table('services', function (Blueprint $table) {
            $table->boolean('is_active')->default(true);
        });

        DB::statement("UPDATE services SET is_active = (status = 'ACTIVE')");

        DB::statement('ALTER TABLE services DROP CONSTRAINT IF EXISTS services_status_check');
        DB::statement('ALTER TABLE services DROP CONSTRAINT IF EXISTS services_pricing_model_check');

        Schema::table('services', function (Blueprint $table) {
            $table->dropColumn(['status', 'pricing_model', 'is_pinned', 'duration_estimate_mins']);
        });

        DB::statement('ALTER TABLE services ALTER COLUMN base_price SET NOT NULL');
    }
};
