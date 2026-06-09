<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * v3.1 §5.4 — `highlights` is the provider-configurable "what shows
     * first" layer on the public profile: an ordering/selection layer over
     * data the provider already has (pinned services, featured portfolio
     * photos, featured badges). No new earned status is created here.
     *
     * Shape: { pinned_service_ids: string[], featured_photo_keys: string[], featured_badges: string[] }
     */
    public function up(): void
    {
        Schema::table('provider_profiles', function (Blueprint $table) {
            $table->jsonb('highlights')
                ->default('{"pinned_service_ids":[],"featured_photo_keys":[],"featured_badges":[]}')
                ->after('certifications');
        });
    }

    public function down(): void
    {
        Schema::table('provider_profiles', function (Blueprint $table) {
            $table->dropColumn('highlights');
        });
    }
};
