<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Growth & Promotions module — campaigns, the spend ledger, referral config, and
 * the per-booking discount stamp.
 *
 * A campaign resolves its audience from LIVE data at eval time (never a stored
 * list). Customer discounts are absorbed by Sebenza (the provider is paid in
 * full); every redemption writes a campaign_ledger_entries row so the Finance
 * module can track marketing spend, and each row is the atomic budget guard.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaigns', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('name', 120);

            // Chosen first — flips the offer mechanics between customer and provider.
            $table->enum('audience_type', ['CUSTOMER', 'PROVIDER'])->default('CUSTOMER');
            // Resolved against real data at send/eval time.
            $table->string('audience_filter', 40);
            // area_regions[], category_ids[], lapsed_days — audience-specific params.
            $table->json('audience_params')->nullable();

            $table->string('offer_type', 40);
            $table->decimal('offer_value', 12, 2)->default(0);
            // e.g. { job_count: N } for ZERO_COMMISSION / BONUS.
            $table->json('offer_params')->nullable();

            // Which slots this renders in — APP_* now, PWA_*/WHATSAPP_* modelled for later.
            $table->json('placements')->nullable();
            // Banner { title, subtitle, cta_label, cta_action, bg_token } + badge_label.
            $table->json('content')->nullable();

            // Code-based campaigns (customer enters a code at checkout).
            $table->string('code', 40)->nullable()->unique();
            $table->boolean('code_multi_use')->default(true);

            $table->timestampTz('start_at')->nullable();
            $table->timestampTz('end_at')->nullable();

            // ZMW marketing budget. budget_spent is the denormalised running total
            // used as the atomic decrement guard; the ledger is the source of truth.
            $table->decimal('budget_cap', 14, 2)->nullable();
            $table->decimal('budget_spent', 14, 2)->default(0);

            $table->unsignedInteger('max_uses_per_user')->nullable();
            $table->unsignedInteger('total_uses_cap')->nullable();
            $table->unsignedInteger('total_uses')->default(0);

            $table->enum('status', [
                'DRAFT', 'SCHEDULED', 'LIVE', 'PAUSED', 'ENDED', 'BUDGET_EXHAUSTED',
            ])->default('DRAFT');

            $table->uuid('created_by_admin_id')->nullable();
            $table->timestamps();

            $table->index(['status', 'start_at', 'end_at']);
            $table->index(['audience_type', 'audience_filter']);
        });

        // One row per redemption AND per spend entry (feeds the Finance module).
        // UNIQUE(campaign_id, booking_id) is the idempotency guard for checkout
        // apply — a double-tap / retry re-uses the booking id and no-ops.
        Schema::create('campaign_ledger_entries', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('campaign_id');
            $table->uuid('user_id')->nullable();
            $table->uuid('booking_id')->nullable();
            $table->enum('kind', [
                'CUSTOMER_DISCOUNT', 'FOREGONE_COMMISSION', 'PROVIDER_BONUS',
            ]);
            $table->decimal('amount_zmw', 14, 2)->default(0);
            $table->timestampTz('created_at')->useCurrent();

            $table->foreign('campaign_id')->references('id')->on('campaigns')->cascadeOnDelete();
            $table->unique(['campaign_id', 'booking_id']);
            $table->index(['campaign_id', 'created_at']);
            $table->index(['campaign_id', 'user_id']);
        });

        // Single-row config surface. Referrals are modelled but not yet active.
        Schema::create('referral_configs', function (Blueprint $table) {
            $table->id();
            $table->boolean('enabled')->default(false);
            $table->decimal('referrer_reward_zmw', 12, 2)->default(0);
            $table->decimal('referee_reward_zmw', 12, 2)->default(0);
            $table->unsignedInteger('max_referrals_per_user')->nullable();
            $table->decimal('budget_cap', 14, 2)->nullable();
            $table->decimal('budget_spent', 14, 2)->default(0);
            $table->timestamps();
        });

        Schema::table('bookings', function (Blueprint $table) {
            $table->uuid('campaign_id')->nullable();
            $table->decimal('campaign_discount_zmw', 12, 2)->default(0);
            $table->string('promo_code', 40)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn(['campaign_id', 'campaign_discount_zmw', 'promo_code']);
        });
        Schema::dropIfExists('referral_configs');
        Schema::dropIfExists('campaign_ledger_entries');
        Schema::dropIfExists('campaigns');
    }
};
