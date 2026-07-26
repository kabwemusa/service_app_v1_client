<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 2 — data-integrity & concurrency guards.
 *
 *  - payout_claimed_at : atomic claim marker so exactly one caller can disburse a
 *    booking (TXN-1). disbursed_at stays the "actually paid out" marker.
 *  - refunded_at       : idempotent-refund marker so a retried cancel can't refund
 *    twice (TXN-3).
 *  - idempotency_key    : de-dupes double-tap / retried booking creates (CON-1).
 *  - unique partial indexes on the gateway references so a duplicate hold/payout
 *    reference can never exist, and callback look-ups are index-served (DB-1).
 *  - unique (external_ref, pawapay_status) on pawapay_events so a redelivered
 *    callback doesn't double-count in the Finance dashboards (CON-4).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function ($table) {
            $table->timestampTz('payout_claimed_at')->nullable();
            $table->timestampTz('refunded_at')->nullable();
            $table->string('idempotency_key', 80)->nullable();
        });

        // One booking per idempotency key (per creator is enforced in code; the
        // key itself is generated unique client-side, so a global partial unique
        // is the correct backstop).
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_idempotency_key ON bookings (idempotency_key) WHERE idempotency_key IS NOT NULL');

        // Gateway references are unique when present — doubles as the idempotency
        // backstop for holds/payouts and makes callback look-ups index scans.
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_escrow_hold_ref ON bookings (escrow_hold_ref) WHERE escrow_hold_ref IS NOT NULL');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_balance_hold_ref ON bookings (balance_hold_ref) WHERE balance_hold_ref IS NOT NULL');

        // Payout-batch selectivity + stale-claim self-heal (COMPLETED, not yet paid).
        DB::statement("CREATE INDEX IF NOT EXISTS idx_bookings_payout_due ON bookings (payout_eligible_at) WHERE status = 'COMPLETED' AND disbursed_at IS NULL");

        // Redelivered callback → same (external_ref, status): reject the duplicate
        // row. logEvent already swallows the resulting exception.
        //
        // First de-dupe any EXISTING duplicates (redelivered callbacks logged more
        // than one row before this guard existed), keeping the earliest per group,
        // or the unique index can't be built.
        DB::statement("
            DELETE FROM pawapay_events a
            USING pawapay_events b
            WHERE a.external_ref = b.external_ref
              AND a.pawapay_status = b.pawapay_status
              AND (a.created_at > b.created_at
                   OR (a.created_at = b.created_at AND a.ctid > b.ctid))
        ");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_pawapay_events_ref_status ON pawapay_events (external_ref, pawapay_status)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS uq_bookings_idempotency_key');
        DB::statement('DROP INDEX IF EXISTS uq_bookings_escrow_hold_ref');
        DB::statement('DROP INDEX IF EXISTS uq_bookings_balance_hold_ref');
        DB::statement('DROP INDEX IF EXISTS idx_bookings_payout_due');
        DB::statement('DROP INDEX IF EXISTS uq_pawapay_events_ref_status');

        Schema::table('bookings', function ($table) {
            $table->dropColumn(['payout_claimed_at', 'refunded_at', 'idempotency_key']);
        });
    }
};
