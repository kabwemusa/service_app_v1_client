<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Schema note (v3.1 task): adds a public profile-photo field (avatar_url) to
 * provider_profiles.  This is DISTINCT from the private KYC selfie / liveness
 * image stored on identity_documents — never surface the KYC image as the
 * public avatar.  Uses the same public-disk storage pipeline as portfolio images
 * (NSFW scan, EXIF strip).
 *
 * Also adds base_location_label — a human-readable geocoded label for the
 * provider's base location (e.g. "Kabwata, Lusaka"), populated by the geocoding
 * pipeline (v3.1 §4.3) when the provider sets their location.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('provider_profiles', function (Blueprint $table) {
            $table->string('avatar_url')->nullable()->after('cover_image_url');
            $table->string('base_location_label')->nullable()->after('base_location_lng');
        });
    }

    public function down(): void
    {
        Schema::table('provider_profiles', function (Blueprint $table) {
            $table->dropColumn(['avatar_url', 'base_location_label']);
        });
    }
};
