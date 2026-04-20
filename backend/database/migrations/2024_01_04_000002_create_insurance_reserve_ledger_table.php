<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 7 §11.5 — Insurance reserve ledger.
 *
 * Every booking credits buyer_protection_fee as CREDIT.
 * Approved damage claims or full RESOLVED_BUYER disputes debit as CLAIM.
 * Admins can manually credit/debit as ADJUSTMENT.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('insurance_reserve_ledger', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->string('entry_type', 15);
            // CREDIT | CLAIM | ADJUSTMENT

            $table->decimal('amount', 10, 2);   // always positive; entry_type determines direction

            $table->uuid('booking_id')->nullable();
            $table->foreign('booking_id')->references('id')->on('bookings')->nullOnDelete();

            $table->uuid('dispute_id')->nullable();
            $table->foreign('dispute_id')->references('id')->on('disputes')->nullOnDelete();

            $table->text('note')->nullable();

            $table->uuid('created_by')->nullable();   // null = system
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();

            $table->timestampTz('created_at')->useCurrent();
        });

        DB::statement('CREATE INDEX idx_reserve_ledger_type_date ON insurance_reserve_ledger (entry_type, created_at)');
    }

    public function down(): void
    {
        Schema::dropIfExists('insurance_reserve_ledger');
    }
};
