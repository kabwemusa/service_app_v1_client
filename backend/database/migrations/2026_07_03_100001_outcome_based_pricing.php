<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Outcome-based pricing — customers never input hours.
 *
 * services.pricing_model becomes:
 *   OUTCOME_FIXED  (was FIXED)   — fixed price per outcome
 *   PROVIDER_SCOPE (was QUOTE)   — customer brief → provider scoped quote → escrow
 *   HOURLY_CAPPED  (was HOURLY)  — rate + minimum + spend cap; cap held, actual charged
 *   QUOTE_DEPOSIT  (new)         — brief → full quote → deposit escrow → balance at completion
 *
 * bookings gain the scope-brief/quote/actual-time/deposit fields and three
 * new states: SCOPE_PENDING, QUOTE_SENT, DEPOSIT_HELD. Also repairs the
 * status CHECK which was missing PAYMENT_FAILED (deposit-failed callbacks
 * crashed against the constraint).
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── services: new pricing fields ─────────────────────────────────
        Schema::table('services', function (Blueprint $table) {
            $table->decimal('hourly_rate', 10, 2)->nullable()->after('base_price')
                ->comment('HOURLY_CAPPED / PROVIDER_SCOPE rate per hour');
            $table->decimal('minimum_hours', 4, 1)->nullable()->after('hourly_rate')
                ->comment('HOURLY_CAPPED minimum billable hours');
            $table->decimal('cap_hours', 4, 1)->nullable()->after('minimum_hours')
                ->comment('HOURLY_CAPPED maximum hours (cap_amount = cap_hours × rate)');
            $table->decimal('cap_amount', 10, 2)->nullable()->after('cap_hours')
                ->comment('HOURLY_CAPPED spend cap held in escrow at booking');
            $table->unsignedTinyInteger('deposit_percent')->nullable()->after('cap_amount')
                ->comment('QUOTE_DEPOSIT deposit percentage (default 30)');
            $table->jsonb('scope_prompts')->nullable()->after('deposit_percent')
                ->comment('PROVIDER_SCOPE/QUOTE_DEPOSIT structured brief questions ["How many bedrooms?", ...]');
            $table->boolean('needs_pricing_review')->default(false)->after('scope_prompts')
                ->comment('Set by the HOURLY→HOURLY_CAPPED migration: provider must confirm the default cap');
        });

        // ── services: migrate data + swap the pricing_model constraint ───
        DB::statement('ALTER TABLE services DROP CONSTRAINT IF EXISTS services_pricing_model_check');

        // Old column was VARCHAR(10); the new model names are longer.
        DB::statement('ALTER TABLE services ALTER COLUMN pricing_model TYPE VARCHAR(20)');

        // FIXED → OUTCOME_FIXED (price unchanged)
        DB::statement("UPDATE services SET pricing_model = 'OUTCOME_FIXED' WHERE pricing_model = 'FIXED'");

        // HOURLY → HOURLY_CAPPED: rate = old base_price, 1-hr minimum, default
        // 4-hr cap; flagged so the provider reviews the cap.
        DB::statement("
            UPDATE services SET
                pricing_model        = 'HOURLY_CAPPED',
                hourly_rate          = base_price,
                minimum_hours        = 1.0,
                cap_hours            = 4.0,
                cap_amount           = ROUND(base_price * 4, 2),
                base_price           = ROUND(base_price * 4, 2),
                needs_pricing_review = TRUE
            WHERE pricing_model = 'HOURLY'
        ");

        // QUOTE → PROVIDER_SCOPE (no price; brief → scoped quote)
        DB::statement("UPDATE services SET pricing_model = 'PROVIDER_SCOPE' WHERE pricing_model = 'QUOTE'");

        DB::statement("ALTER TABLE services ADD CONSTRAINT services_pricing_model_check
            CHECK (pricing_model IN ('OUTCOME_FIXED','PROVIDER_SCOPE','HOURLY_CAPPED','QUOTE_DEPOSIT'))");

        // Mirror the rename on the provider_services join (WhatsApp catalog).
        DB::statement("UPDATE provider_services SET pricing_model = 'OUTCOME_FIXED'  WHERE pricing_model = 'FIXED'");
        DB::statement("UPDATE provider_services SET pricing_model = 'HOURLY_CAPPED'  WHERE pricing_model = 'HOURLY'");
        DB::statement("UPDATE provider_services SET pricing_model = 'PROVIDER_SCOPE' WHERE pricing_model = 'QUOTE'");

        // ── bookings: scope brief / quote / actual time / deposit fields ─
        Schema::table('bookings', function (Blueprint $table) {
            $table->jsonb('scope_brief')->nullable()->after('notes')
                ->comment('Customer structured brief answers [{question, answer}]');
            $table->jsonb('provider_quote')->nullable()->after('scope_brief')
                ->comment('Scoped quote {price, duration_mins, inclusions[], message}');
            $table->decimal('actual_hours_logged', 4, 1)->nullable()->after('provider_quote')
                ->comment('HOURLY_CAPPED: provider-logged actual time (0.5-hr increments)');
            $table->decimal('actual_charge_zmw', 10, 2)->nullable()->after('actual_hours_logged')
                ->comment('HOURLY_CAPPED: final charge = max(actual, minimum) × rate, ≤ cap');
            $table->decimal('deposit_amount', 10, 2)->nullable()->after('actual_charge_zmw')
                ->comment('QUOTE_DEPOSIT: deposit held at confirm');
            $table->decimal('balance_amount', 10, 2)->nullable()->after('deposit_amount')
                ->comment('QUOTE_DEPOSIT: balance collected at completion');
            $table->string('balance_hold_ref', 128)->nullable()->after('balance_amount')
                ->comment('QUOTE_DEPOSIT: gateway depositId of the balance collection');
            $table->string('escrow_phase', 10)->nullable()->after('balance_hold_ref')
                ->comment('FULL | DEPOSIT | BALANCE — which collection the escrow hold covers');
        });

        DB::statement("ALTER TABLE bookings ADD CONSTRAINT bookings_escrow_phase_check
            CHECK (escrow_phase IS NULL OR escrow_phase IN ('FULL','DEPOSIT','BALANCE'))");

        // ── bookings: extend the status CHECK (new states + missing PAYMENT_FAILED) ─
        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check');
        DB::statement("
            ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
                'REQUESTED','QUOTED','ACCEPTED','DECLINED','EXPIRED','NO_SHOW',
                'SCOPE_PENDING','QUOTE_SENT',
                'PENDING_PAYMENT','PAYMENT_FAILED','AWAITING_KYC','FUNDS_HELD','DEPOSIT_HELD',
                'IN_PROGRESS','DELIVERED','COMPLETED','DISPUTED',
                'CANCELLED','DISBURSED','CHARGEBACK_PENDING'
            ))
        ");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check');
        DB::statement("
            ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
                'REQUESTED','QUOTED','ACCEPTED','DECLINED','EXPIRED','NO_SHOW',
                'PENDING_PAYMENT','AWAITING_KYC','FUNDS_HELD',
                'IN_PROGRESS','DELIVERED','COMPLETED','DISPUTED',
                'CANCELLED','DISBURSED','CHARGEBACK_PENDING'
            ))
        ");

        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_escrow_phase_check');
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn([
                'scope_brief', 'provider_quote', 'actual_hours_logged', 'actual_charge_zmw',
                'deposit_amount', 'balance_amount', 'balance_hold_ref', 'escrow_phase',
            ]);
        });

        DB::statement('ALTER TABLE services DROP CONSTRAINT IF EXISTS services_pricing_model_check');
        DB::statement("UPDATE services SET pricing_model = 'FIXED'  WHERE pricing_model = 'OUTCOME_FIXED'");
        DB::statement("UPDATE services SET base_price = hourly_rate, pricing_model = 'HOURLY' WHERE pricing_model = 'HOURLY_CAPPED'");
        DB::statement("UPDATE services SET pricing_model = 'QUOTE'  WHERE pricing_model IN ('PROVIDER_SCOPE','QUOTE_DEPOSIT')");
        DB::statement("ALTER TABLE services ADD CONSTRAINT services_pricing_model_check
            CHECK (pricing_model IN ('FIXED','HOURLY','QUOTE'))");

        DB::statement("UPDATE provider_services SET pricing_model = 'FIXED'  WHERE pricing_model = 'OUTCOME_FIXED'");
        DB::statement("UPDATE provider_services SET pricing_model = 'HOURLY' WHERE pricing_model = 'HOURLY_CAPPED'");
        DB::statement("UPDATE provider_services SET pricing_model = 'QUOTE'  WHERE pricing_model IN ('PROVIDER_SCOPE','QUOTE_DEPOSIT')");

        Schema::table('services', function (Blueprint $table) {
            $table->dropColumn([
                'hourly_rate', 'minimum_hours', 'cap_hours', 'cap_amount',
                'deposit_percent', 'scope_prompts', 'needs_pricing_review',
            ]);
        });
    }
};
