<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 6: extend bookings for v3 escrow state machine (§12).
 *
 * New status values : AWAITING_KYC, CHARGEBACK_PENDING, DISBURSED
 * New columns       : amount, buyer_protection_fee, payout_eligible_at,
 *                     completed_at, disbursed_at, instant_payout_requested
 */
return new class extends Migration
{
    public function up(): void
    {
        // Laravel's enum() on PostgreSQL creates a CHECK constraint, not a named TYPE.
        // Drop the existing constraint and recreate it with the three new values.
        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check');
        DB::statement("
            ALTER TABLE bookings
            ADD CONSTRAINT bookings_status_check
            CHECK (status IN (
                'PENDING_PAYMENT',
                'AWAITING_KYC',
                'FUNDS_HELD',
                'IN_PROGRESS',
                'DELIVERED',
                'COMPLETED',
                'DISPUTED',
                'CHARGEBACK_PENDING',
                'DISBURSED',
                'CANCELLED'
            ))
        ");

        Schema::table('bookings', function (Blueprint $table) {
            // Snapshot of the service price at booking time (immutable)
            $table->decimal('amount', 10, 2)->nullable()->after('service_id');

            // 2% buyer protection fee (§8.3), capped at ZMW 50
            $table->decimal('buyer_protection_fee', 8, 2)->default(0.00)->after('amount');

            // When the tiered hold expires and payout can be dispatched
            $table->timestampTz('payout_eligible_at')->nullable()->after('buyer_protection_fee');

            // Provider requests to skip the hold for a 1% fee
            $table->boolean('instant_payout_requested')->default(false)->after('payout_eligible_at');

            // Timestamped milestones
            $table->timestampTz('completed_at')->nullable()->after('updated_at');
            $table->timestampTz('disbursed_at')->nullable()->after('completed_at');
        });

        // Index for the payout eligibility batch worker
        DB::statement('
            CREATE INDEX idx_bookings_payout_eligible
            ON bookings (payout_eligible_at, status)
            WHERE status IN (\'COMPLETED\', \'DISBURSED\')
        ');
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn([
                'amount',
                'buyer_protection_fee',
                'payout_eligible_at',
                'instant_payout_requested',
                'completed_at',
                'disbursed_at',
            ]);
        });

        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check');
        DB::statement("
            ALTER TABLE bookings
            ADD CONSTRAINT bookings_status_check
            CHECK (status IN (
                'PENDING_PAYMENT',
                'FUNDS_HELD',
                'IN_PROGRESS',
                'DELIVERED',
                'COMPLETED',
                'DISPUTED',
                'CANCELLED'
            ))
        ");
    }
};
