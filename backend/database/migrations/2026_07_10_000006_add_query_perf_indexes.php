<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Phase 6 — query-performance indexes (§ DB-7) for the hot buyer/provider list
 * paths that currently only have a single-column `buyer_id` index.
 *
 *  - bookings(buyer_id, status)     : GET /bookings, /me/book-again, /me/providers
 *    all filter buyer_id + status.
 *  - bookings(provider_id, status)  : incoming requests + payout batch scans.
 *  - reviews(reviewer_id)           : "have I reviewed this" + reviewer look-ups.
 *
 * CONCURRENTLY is not used (migrations run in a transaction); these tables are
 * small at pilot scale so a brief lock is fine.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE INDEX IF NOT EXISTS idx_bookings_buyer_status ON bookings (buyer_id, status)');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_bookings_provider_status ON bookings (provider_id, status)');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews (reviewer_id)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_bookings_buyer_status');
        DB::statement('DROP INDEX IF EXISTS idx_bookings_provider_status');
        DB::statement('DROP INDEX IF EXISTS idx_reviews_reviewer');
    }
};
