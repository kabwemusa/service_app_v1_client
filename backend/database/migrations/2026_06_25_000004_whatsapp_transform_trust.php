<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ── Risk-tier configuration: per-category risk classification ────
        Schema::create('risk_tier_configs', function (Blueprint $table) {
            $table->id();
            $table->unsignedTinyInteger('risk_tier')
                ->comment('1=remote, 2=public-venue, 3=in-home');
            $table->string('label', 30);
            $table->json('eligibility_requirements')
                ->comment('Tier requirements: {tier_1: ["nrc","momo_match"], tier_2: ["+portfolio"], tier_3: ["+police_clearance"]}');
            $table->text('description')->nullable();
            $table->timestamps();

            $table->unique('risk_tier');
        });

        // Seed the three risk tiers
        \Illuminate\Support\Facades\DB::table('risk_tier_configs')->insert([
            [
                'risk_tier' => 1,
                'label' => 'Remote',
                'eligibility_requirements' => json_encode([
                    'tier_1' => ['nrc', 'momo_name_match'],
                    'tier_2' => ['nrc', 'momo_name_match'],
                    'tier_3' => ['nrc', 'momo_name_match'],
                ]),
                'description' => 'Services performed remotely or digitally. Lowest risk — basic identity verification required.',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'risk_tier' => 2,
                'label' => 'Public Venue',
                'eligibility_requirements' => json_encode([
                    'tier_1' => ['nrc', 'momo_name_match'],
                    'tier_2' => ['nrc', 'momo_name_match', 'portfolio'],
                    'tier_3' => ['nrc', 'momo_name_match', 'portfolio'],
                ]),
                'description' => 'Services performed in public venues (salon, studio, etc). Medium risk — portfolio required for Tier 2+.',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'risk_tier' => 3,
                'label' => 'In-Home',
                'eligibility_requirements' => json_encode([
                    'tier_1' => ['nrc', 'momo_name_match'],
                    'tier_2' => ['nrc', 'momo_name_match', 'portfolio'],
                    'tier_3' => ['nrc', 'momo_name_match', 'portfolio', 'police_clearance'],
                ]),
                'description' => 'Services performed at the customer\'s home. Highest risk — police clearance required for Tier 3.',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        // ── Provider verifications: normalized verification records ──────
        Schema::create('provider_verifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('provider_id');
            $table->string('verification_type', 30)
                ->comment('nrc, momo_name_match, portfolio, police_clearance, selfie_match');
            $table->string('status', 20)->default('PENDING')
                ->comment('PENDING, VERIFIED, REJECTED, EXPIRED');
            $table->json('metadata')->nullable()
                ->comment('Type-specific data (doc ref, match score, expiry, etc.)');
            $table->timestamp('verified_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->uuid('verified_by')->nullable()
                ->comment('Admin who approved, null for auto-verified');
            $table->timestamps();

            $table->foreign('provider_id')->references('id')->on('users')->cascadeOnDelete();
            $table->unique(['provider_id', 'verification_type']);
            $table->index(['provider_id', 'status']);
        });

        // ── Trust signals: per-provider internal-only trust metrics ──────
        Schema::create('trust_signals', function (Blueprint $table) {
            $table->uuid('provider_id')->primary();
            // Identity strength (0–100 internal only)
            $table->float('identity_strength')->default(0)
                ->comment('Composite identity verification strength — INTERNAL ONLY');
            // Reliability metrics
            $table->float('reliability_pct')->default(0)
                ->comment('Job completion reliability — INTERNAL ONLY');
            $table->float('on_time_pct')->default(0)
                ->comment('On-time arrival/completion — INTERNAL ONLY');
            // Financial / dispute history
            $table->float('dispute_rate')->default(0)
                ->comment('Dispute rate over lifetime — INTERNAL ONLY');
            $table->float('financial_health')->default(0)
                ->comment('Payment/commission health score — INTERNAL ONLY');
            // Bayesian rating
            $table->float('bayesian_rating')->default(0)
                ->comment('Bayesian-smoothed rating — INTERNAL ONLY');
            $table->unsignedInteger('rating_count')->default(0);
            // Composite trust score (replaces the old provider_profiles.trust_score)
            $table->float('composite_score')->default(0)
                ->comment('Weighted composite of all signals — INTERNAL ONLY, NEVER surface to any channel');

            $table->timestamp('last_computed_at')->nullable();
            $table->timestamps();

            $table->foreign('provider_id')->references('id')->on('users')->cascadeOnDelete();
        });

        // ── Users: add WhatsApp identity field ──────────────────────────
        Schema::table('users', function (Blueprint $table) {
            $table->string('wa_id', 30)->nullable()->after('phone')
                ->comment('WhatsApp Business API phone_number_id');
            $table->index('wa_id');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['wa_id']);
            $table->dropColumn('wa_id');
        });

        Schema::dropIfExists('trust_signals');
        Schema::dropIfExists('provider_verifications');
        Schema::dropIfExists('risk_tier_configs');
    }
};
