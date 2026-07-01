<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Progressive provider onboarding (onboarding flow spec).
 *
 *   DRAFT   — mid-flow, resumable.
 *   SET_UP  — universal base (NRC + MoMo + selfie = Tier 1) done; live for any
 *             permitted (Tier-1) categories, but a listed Tier-2/3 service is
 *             still PENDING its extra verification.
 *   LIVE    — eligible to receive jobs in the chosen category.
 *
 * The step cursor + chosen offering let a dropped-off applicant resume exactly
 * where they left, and give go-live the service whose risk tier to check.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('provider_profiles', function (Blueprint $table) {
            $table->string('onboarding_state', 16)->default('DRAFT')->after('kyc_status');
            $table->string('onboarding_step', 32)->nullable()->after('onboarding_state');
            $table->unsignedBigInteger('onboarding_category_id')->nullable()->after('onboarding_step');
            $table->uuid('onboarding_service_id')->nullable()->after('onboarding_category_id');
        });

        // Existing providers are past onboarding — treat them as LIVE so the new
        // state column never gates an already-active account.
        DB::statement("UPDATE provider_profiles SET onboarding_state = 'LIVE' WHERE trust_tier >= 1");
    }

    public function down(): void
    {
        Schema::table('provider_profiles', function (Blueprint $table) {
            $table->dropColumn([
                'onboarding_state',
                'onboarding_step',
                'onboarding_category_id',
                'onboarding_service_id',
            ]);
        });
    }
};
