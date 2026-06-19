<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Emergency events — §11.4 Emergency Button.
 *
 * The in-app emergency control (available during IN_PROGRESS bookings) notifies
 * the platform's on-call safety team and triggers a 2-hour post-incident
 * outreach. THIS table is the platform-side record of that notification — the
 * thing the admin Safety triage queue surfaces at the top, visually distinct,
 * with an SLA timer.
 *
 * The consumer-side button that PRODUCES these rows (calling 991, messaging the
 * emergency contact, sharing live location) is built elsewhere; this migration
 * only adds the persistence + admin triage columns the panel reads/writes.
 *
 * Confidentiality: location_label is coarse context for the responding admin —
 * never exposed to the reported party. The reporter (triggered_by) is the buyer
 * in distress and must never be surfaced to the other party.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('emergency_events', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            // The buyer who triggered the emergency (the party in distress).
            $table->uuid('triggered_by');
            $table->foreign('triggered_by')->references('id')->on('users');

            // The other party on the booking (provider), if any.
            $table->uuid('reported_id')->nullable();
            $table->foreign('reported_id')->references('id')->on('users')->nullOnDelete();

            $table->uuid('booking_id')->nullable();
            $table->foreign('booking_id')->references('id')->on('bookings')->nullOnDelete();

            $table->string('status', 20)->default('ACTIVE');
            // ACTIVE | ACKNOWLEDGED | RESOLVED

            // Coarse location context shared with the on-call team (§11.4). No coords.
            $table->string('location_label')->nullable();

            // Triage / assignment — admins act on the `admin` guard (admin_users).
            $table->uuid('assigned_admin_id')->nullable();
            $table->foreign('assigned_admin_id')->references('id')->on('admin_users')->nullOnDelete();
            $table->timestampTz('acknowledged_at')->nullable();

            $table->uuid('resolved_by_admin_id')->nullable();
            $table->foreign('resolved_by_admin_id')->references('id')->on('admin_users')->nullOnDelete();
            $table->timestampTz('resolved_at')->nullable();
            $table->text('outcome')->nullable();

            // §11.4 — automatic post-incident outreach within 2 hours. Drives the SLA timer.
            $table->timestampTz('outreach_due_at')->nullable();

            $table->timestampTz('created_at')->useCurrent();
        });

        DB::statement('CREATE INDEX idx_emergency_events_open ON emergency_events (status, created_at)');
    }

    public function down(): void
    {
        Schema::dropIfExists('emergency_events');
    }
};
