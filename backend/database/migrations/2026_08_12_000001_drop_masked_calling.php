<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Masked calling removed (product decision, 2026-08-12).
 *
 * A call arriving from an unfamiliar virtual number reads as spam in Zambia and
 * goes unanswered, so the proxy layer destroyed exactly the trust it existed to
 * protect. The parties now dial each other directly; contact is still gated to
 * funded, active bookings by ContactWindow — the gate moved from the transport
 * to the number itself.
 *
 * `booking_call_sessions` held metadata only (who/when/duration, masked number —
 * never content, never a real number), so nothing of evidentiary value is lost.
 * The dispute trail lives in `booking_status_updates`, which stays.
 *
 * Also drops LOCATION_NOTE status updates: the free-text preset went with the
 * messaging surfaces, so those rows can no longer be produced or rendered.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('booking_call_sessions');

        // Orphaned free-text rows — the preset no longer exists, so the client
        // would render a body for an update type it cannot explain.
        if (Schema::hasTable('booking_status_updates')) {
            DB::table('booking_status_updates')->where('type', 'LOCATION_NOTE')->delete();
        }
    }

    public function down(): void
    {
        // Recreated for rollback parity only — nothing writes to this table any
        // more. Deleted LOCATION_NOTE rows are NOT restored (they are gone).
        if (Schema::hasTable('booking_call_sessions')) {
            return;
        }

        Schema::create('booking_call_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            $table->uuid('initiator_id');
            $table->string('initiator_role', 10);
            $table->string('provider', 32);
            $table->string('session_ref', 128)->nullable();
            $table->string('masked_number', 32)->nullable();
            $table->string('status', 20);
            $table->unsignedInteger('duration_seconds')->nullable();
            $table->timestamp('reveal_expires_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('answered_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->foreign('booking_id')->references('id')->on('bookings')->cascadeOnDelete();
            $table->foreign('initiator_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index(['booking_id', 'created_at']);
            $table->index('session_ref');
        });
    }
};
