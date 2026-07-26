<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Communication layer + Booking Agreement document.
 *
 * Three immutable-by-design tables backing the provider↔customer comms layer
 * (NO in-app chat / VoIP is built) and the downloadable Booking Agreement:
 *
 *   booking_status_updates  — tap-to-send preset status messages ("On my way",
 *                             "Arrived", …). Write-once dispute evidence.
 *   booking_call_sessions   — masked-call METADATA only (who/when/duration/
 *                             booking). Never call content. Has a short lifecycle
 *                             (INITIATED → … → terminal) while the call runs.
 *   booking_agreements      — versioned, immutable Booking Agreement documents,
 *                             one row per version; a material change mints a new
 *                             version and keeps the prior ones.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── Structured status updates (immutable) ────────────────────────────
        Schema::create('booking_status_updates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            $table->uuid('actor_id');
            $table->string('actor_role', 10);            // provider | customer
            $table->string('type', 24);                  // config('communication.status_presets') key
            $table->jsonb('payload')->nullable();        // {duration_mins} | {note}
            $table->text('body');                        // rendered body snapshot (evidence)
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['booking_id', 'created_at']);
            $table->foreign('booking_id')->references('id')->on('bookings')->cascadeOnDelete();
        });

        DB::statement("ALTER TABLE booking_status_updates ADD CONSTRAINT booking_status_updates_role_check
            CHECK (actor_role IN ('provider','customer'))");

        // ── Masked-call sessions (metadata only — NEVER call content) ────────
        Schema::create('booking_call_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            $table->uuid('initiator_id');
            $table->string('initiator_role', 10);        // provider | customer
            $table->string('provider', 20);              // africastalking | log | reveal
            $table->string('session_ref', 128)->nullable();   // provider's session id
            // The PROXY/masked number only — never a party's real MSISDN.
            $table->string('masked_number', 32)->nullable();
            $table->string('status', 20)->default('INITIATED');
            // Consented-reveal fallback ONLY: when set, the fallback exposed a
            // real number for a limited window (flagged exception — see
            // config/communication.php + LEGAL_REVIEW.md).
            $table->timestampTz('reveal_expires_at')->nullable();
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('answered_at')->nullable();
            $table->timestampTz('ended_at')->nullable();
            $table->unsignedInteger('duration_seconds')->nullable();
            $table->jsonb('metadata')->nullable();
            $table->timestampsTz();

            $table->index(['booking_id', 'created_at']);
            $table->foreign('booking_id')->references('id')->on('bookings')->cascadeOnDelete();
        });

        DB::statement("ALTER TABLE booking_call_sessions ADD CONSTRAINT booking_call_sessions_role_check
            CHECK (initiator_role IN ('provider','customer'))");
        DB::statement("ALTER TABLE booking_call_sessions ADD CONSTRAINT booking_call_sessions_status_check
            CHECK (status IN ('INITIATED','RINGING','IN_PROGRESS','COMPLETED','NO_ANSWER','FAILED','CANCELLED'))");

        // ── Booking Agreement documents (versioned, immutable) ───────────────
        Schema::create('booking_agreements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('booking_id');
            $table->unsignedInteger('version');
            // sha256 of the captured snapshot — a material change yields a new
            // hash → a new version; an identical state is a no-op (idempotent).
            $table->string('content_hash', 64);
            $table->string('status_snapshot', 20);       // booking status at generation
            $table->string('reason', 40);                // CONFIRMATION | QUOTE_APPROVED | CAP_EXTENSION | RESCHEDULE
            $table->string('terms_version', 40)->nullable();
            $table->date('terms_effective_date')->nullable();
            $table->string('format', 8)->default('pdf'); // pdf | html
            $table->string('document_path', 255);        // path on the private disk
            $table->jsonb('snapshot');                   // the real data the document was built from
            $table->timestampTz('generated_at')->useCurrent();
            $table->timestampsTz();

            $table->unique(['booking_id', 'version']);
            $table->index(['booking_id', 'generated_at']);
            $table->foreign('booking_id')->references('id')->on('bookings')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('booking_agreements');
        Schema::dropIfExists('booking_call_sessions');
        Schema::dropIfExists('booking_status_updates');
    }
};
