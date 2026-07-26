<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * § ERR-2 — durable retry queue for money-path external calls that fail AFTER
 * the local state was committed (a refund, a payout, a balance collection). The
 * old code caught these and only logged, so a lost log line meant lost money.
 * Now the failure is persisted here and a scheduled worker re-attempts it with
 * backoff until it resolves or a human intervenes. The admin Finance module can
 * surface PENDING/FAILED rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_reconciliations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            // REFUND | PAYOUT | BALANCE_COLLECTION
            $table->string('kind', 30);
            $table->decimal('amount', 12, 2)->nullable();
            // Gateway reference we act against (deposit hold ref) + the destination
            // phone, captured so the retry needs no extra look-ups.
            $table->string('hold_ref', 128)->nullable();
            $table->string('phone', 32)->nullable();
            // PENDING | RESOLVED | ABANDONED
            $table->string('status', 20)->default('PENDING');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->text('last_error')->nullable();
            $table->timestampTz('next_attempt_at')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            $table->timestamps();

            $table->foreign('booking_id')->references('id')->on('bookings')->cascadeOnDelete();
            $table->index(['status', 'next_attempt_at']);
            $table->index('booking_id');
            // One open reconciliation per (booking, kind): re-recording an existing
            // open item updates it rather than piling up duplicates.
            $table->index(['booking_id', 'kind', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_reconciliations');
    }
};
