<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 1 — Extend the status enum to include DIRECT states
        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check');
        DB::statement("
            ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
                'REQUESTED','QUOTED','ACCEPTED','DECLINED','EXPIRED','NO_SHOW',
                'PENDING_PAYMENT','AWAITING_KYC','FUNDS_HELD',
                'IN_PROGRESS','DELIVERED','COMPLETED','DISPUTED',
                'CANCELLED','DISBURSED','CHARGEBACK_PENDING'
            ))
        ");

        Schema::table('bookings', function (Blueprint $table) {
            // 2 — Payment mode (immutable per booking)
            $table->string('payment_mode', 10)->default('ESCROW')->after('id');

            // 3 — DIRECT payment tracking (informational only — no fund custody)
            $table->string('payment_status', 20)->nullable()->after('payment_mode');
            $table->uuid('payment_marked_by')->nullable()->after('payment_status');
            $table->timestampTz('payment_marked_at')->nullable()->after('payment_marked_by');

            // 4 — Negotiated final price; set on accept/acceptQuote
            $table->decimal('agreed_amount', 12, 2)->nullable()->after('buyer_protection_fee');

            // 5 — Response deadline for REQUESTED state (DIRECT only)
            $table->timestampTz('expires_at')->nullable()->after('payout_eligible_at');
        });

        DB::statement("
            ALTER TABLE bookings
            ADD CONSTRAINT bookings_payment_mode_check CHECK (payment_mode IN ('DIRECT','ESCROW'))
        ");

        DB::statement("
            ALTER TABLE bookings
            ADD CONSTRAINT bookings_payment_status_check CHECK (
                payment_status IS NULL OR payment_status IN ('UNPAID','MARKED_PAID')
            )
        ");
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn([
                'payment_mode',
                'payment_status',
                'payment_marked_by',
                'payment_marked_at',
                'agreed_amount',
                'expires_at',
            ]);
        });

        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_mode_check');
        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check');

        // Restore original status constraint (v3 escrow states only)
        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check');
        DB::statement("
            ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
                'PENDING_PAYMENT','AWAITING_KYC','FUNDS_HELD',
                'IN_PROGRESS','DELIVERED','COMPLETED','DISPUTED',
                'CANCELLED','DISBURSED','CHARGEBACK_PENDING'
            ))
        ");
    }
};
