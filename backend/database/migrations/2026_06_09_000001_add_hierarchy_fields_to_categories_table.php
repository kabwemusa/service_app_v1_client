<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            // Hierarchy — nullable self-referential FK
            $table->unsignedBigInteger('parent_id')->nullable()->after('id');

            // Slug for URL-friendly lookups and synonym resolution
            // Added as nullable first; populated below; then constrained
            $table->string('slug', 100)->nullable()->after('name');

            // Admin-maintained synonyms improve text-to-category resolution over time
            $table->jsonb('synonyms')->default('[]')->after('slug');

            // Admin-controlled display order (lower = first)
            $table->integer('display_order')->default(0)->after('is_active');

            // Commission band — REQUIRED. Drives the v3 §8.1 commission schedule.
            // Every category must carry one; creation without it is rejected by the API.
            // Migration uses 'standard' as a safe default for pre-existing rows.
            $table->string('commission_band', 50)->default('standard')->after('display_order');

            // Icon name for client rendering (e.g. 'sparkles-outline' for Ionicons).
            // Eliminates the hardcoded CATEGORY_ICONS map in the mobile app.
            $table->string('icon', 100)->nullable()->after('icon_url');

            $table->foreign('parent_id')
                  ->references('id')
                  ->on('categories')
                  ->onDelete('set null');
        });

        // Populate slug for any rows that already exist
        DB::statement("
            UPDATE categories
            SET slug = LOWER(
                REGEXP_REPLACE(
                    REGEXP_REPLACE(name, '[^a-zA-Z0-9\s-]', '', 'g'),
                    '\s+', '-', 'g'
                )
            )
            WHERE slug IS NULL
        ");

        // Now make slug unique and non-nullable
        Schema::table('categories', function (Blueprint $table) {
            $table->string('slug', 100)->nullable(false)->change();
            $table->unique('slug');
        });
    }

    public function down(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->dropForeign(['parent_id']);
            $table->dropUnique(['slug']);
            $table->dropColumn(['parent_id', 'slug', 'synonyms', 'display_order', 'commission_band', 'icon']);
        });
    }
};
