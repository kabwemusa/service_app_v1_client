<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('provider_profiles', function (Blueprint $table) {
            // Trust tier & composite score
            $table->unsignedTinyInteger('trust_tier')->default(0)->after('profile_completeness');
            $table->decimal('trust_score', 3, 2)->default(0.00)->after('trust_tier');

            // Identity (legal name lives on users; display name is provider-specific)
            // $table->string('display_name')->nullable()->after('trust_score');
            // $table->text('bio')->nullable()->after('display_name');
            $table->unsignedSmallInteger('year_started')->nullable()->after('bio');
            $table->jsonb('languages')->default('[]')->after('year_started');

            // Geo override
            $table->unsignedSmallInteger('service_radius_km')->default(5)->after('languages');

            // Responsiveness metrics (computed nightly)
            $table->unsignedSmallInteger('response_time_p50_mins')->default(60)->after('service_radius_km');
            $table->decimal('response_rate_7d', 3, 2)->default(0.00)->after('response_time_p50_mins');

            // Media
            $table->string('cover_image_url')->nullable()->after('response_rate_7d');
            $table->jsonb('portfolio_images')->default('[]')->after('cover_image_url');

            // Credentials
            $table->jsonb('certifications')->default('[]')->after('portfolio_images');

            // Denormalized performance counters (updated nightly)
            $table->decimal('cancellation_rate_30d', 3, 2)->default(0.00)->after('certifications');
            $table->decimal('repeat_client_rate', 3, 2)->default(0.00)->after('cancellation_rate_30d');

            // Extend kyc_status enum for the new pipeline stages
        });

        // Extend kyc_status to include new pipeline states
        DB::statement("ALTER TABLE provider_profiles DROP CONSTRAINT IF EXISTS provider_profiles_kyc_status_check");
        DB::statement("ALTER TABLE provider_profiles ALTER COLUMN kyc_status TYPE VARCHAR(20)");
        DB::statement("ALTER TABLE provider_profiles ADD CONSTRAINT provider_profiles_kyc_status_check
            CHECK (kyc_status IN ('PENDING','VERIFIED','REJECTED','MANUAL_REVIEW','AUTO_APPROVED','AUTO_REJECTED','SUBMITTED'))");

        // nrc_number and student_id_url are migrated to identity_documents; we NULL them here
        // and drop them in the next release once the migration job has backfilled the new table.
        // Keeping columns prevents breaking existing code during the transition window.

        // Indexes
        DB::statement('CREATE INDEX IF NOT EXISTS idx_pp_trust_tier ON provider_profiles USING btree (trust_tier)');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_pp_trust_score ON provider_profiles USING btree (trust_score)');
    }

    public function down(): void
    {
        Schema::table('provider_profiles', function (Blueprint $table) {
            $table->dropColumn([
                'trust_tier', 'trust_score', 'year_started',
                'languages', 'service_radius_km', 'response_time_p50_mins',
                'response_rate_7d', 'cover_image_url', 'portfolio_images',
                'certifications', 'cancellation_rate_30d', 'repeat_client_rate',
            ]);
        });

        DB::statement("ALTER TABLE provider_profiles DROP CONSTRAINT IF EXISTS provider_profiles_kyc_status_check");
        DB::statement("ALTER TABLE provider_profiles ADD CONSTRAINT provider_profiles_kyc_status_check
            CHECK (kyc_status IN ('PENDING','VERIFIED','REJECTED'))");
    }
};
