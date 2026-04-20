<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 6: per-category, per-tier commission rates (§8.1).
 *
 * commission_rates JSONB shape:
 *   { "1": 0.18, "2": 0.15, "3": 0.13, "4": 0.11 }
 *
 * Seeded with the "standard services" defaults from §8.1.
 * Tunable per-category via the admin panel without code deploys.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->jsonb('commission_rates')->nullable()->after('is_active');
        });

        // Seed sensible defaults for existing categories
        DB::statement("
            UPDATE categories
            SET commission_rates = '{\"1\": 0.18, \"2\": 0.15, \"3\": 0.13, \"4\": 0.11}'::jsonb
            WHERE commission_rates IS NULL
        ");
    }

    public function down(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->dropColumn('commission_rates');
        });
    }
};
