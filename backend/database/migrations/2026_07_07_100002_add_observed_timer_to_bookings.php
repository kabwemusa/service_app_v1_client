<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * HOURLY_CAPPED — observed timer, not self-report.
 *
 * The charge is now derived SERVER-SIDE from a shared start/stop timer:
 *   job_started_at   — provider taps "Start job" (on arrival)
 *   job_ended_at     — provider taps "Finish"
 *   observed_minutes — server-computed elapsed (minus paused spans), the source
 *                      of truth for billing — never a client-entered number
 *   final_charge_zmw — elapsed rounded UP to the increment, ≥ minimum, ≤ the
 *                      approved cap; the hold was the cap, this is charged, the
 *                      difference is auto-refunded
 *   pause_events     — [{paused_at, resumed_at}] audit trail (optional pauses)
 *   cap_extension_zmw / cap_extension_ref — extra hold the customer re-authorised
 *                      when the job approached the cap (cap is never silently
 *                      exceeded)
 *
 * The old provider-entered `actual_hours_logged` is deprecated as a source of
 * truth (kept as a nullable column for old rows; new bookings never write it).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->timestampTz('job_started_at')->nullable()->after('actual_charge_zmw')
                ->comment('HOURLY_CAPPED observed timer — provider "Start job"');
            $table->timestampTz('job_ended_at')->nullable()->after('job_started_at')
                ->comment('HOURLY_CAPPED observed timer — provider "Finish"');
            $table->integer('observed_minutes')->nullable()->after('job_ended_at')
                ->comment('Server-computed elapsed billable minutes (source of truth)');
            $table->decimal('final_charge_zmw', 10, 2)->nullable()->after('observed_minutes')
                ->comment('Observed time rounded up to increment, ≥ minimum, ≤ approved cap');
            $table->jsonb('pause_events')->nullable()->after('final_charge_zmw')
                ->comment('[{paused_at, resumed_at}] audit trail for disputes');
            $table->decimal('cap_extension_zmw', 10, 2)->nullable()->after('pause_events')
                ->comment('Extra hold the customer re-authorised to raise the cap');
            $table->string('cap_extension_ref', 128)->nullable()->after('cap_extension_zmw')
                ->comment('Gateway depositId of the cap-extension re-authorisation');
            $table->timestampTz('cap_extension_requested_at')->nullable()->after('cap_extension_ref')
                ->comment('Provider proposed a cap extension; awaiting customer approval');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn([
                'job_started_at', 'job_ended_at', 'observed_minutes', 'final_charge_zmw',
                'pause_events', 'cap_extension_zmw', 'cap_extension_ref', 'cap_extension_requested_at',
            ]);
        });
    }
};
