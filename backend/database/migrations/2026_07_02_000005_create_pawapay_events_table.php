<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Passive, append-only log of PawaPay collection/payout/refund callbacks.
 * Written from PawapayCallbackController at the point it already parses the
 * payload — no behavior change, purely observability for the admin Finance
 * module's Escrow reconciliation tab (MATCHED/MISMATCH detection is computed
 * at read time by comparing the latest event here against booking.status,
 * not stored, since booking status can move after the event is logged).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pawapay_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id')->nullable();
            $table->string('external_ref', 100); // depositId | payoutId | refundId
            $table->string('type', 20); // collection | payout | refund
            $table->string('pawapay_status', 30);
            $table->string('mno', 20)->nullable(); // MTN | AIRTEL | ZAMTEL — heuristic from the relevant phone
            $table->decimal('amount', 12, 2)->nullable();
            $table->timestamp('created_at');

            $table->foreign('booking_id')->references('id')->on('bookings')->nullOnDelete();
            $table->index(['type', 'created_at']);
            $table->index('booking_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pawapay_events');
    }
};
