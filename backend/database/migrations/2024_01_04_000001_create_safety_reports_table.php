<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 7 §11.3 — Safety reports.
 *
 * Separate from disputes: one-way, immediate action, no adversarial process.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('safety_reports', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->uuid('reporter_id');
            $table->foreign('reporter_id')->references('id')->on('users');

            $table->uuid('reported_id');
            $table->foreign('reported_id')->references('id')->on('users');

            $table->uuid('booking_id')->nullable();
            $table->foreign('booking_id')->references('id')->on('bookings')->nullOnDelete();

            $table->string('category', 30);
            // HARASSMENT | VIOLENCE_THREAT | UNSAFE_BEHAVIOR | DISCRIMINATION | STOLEN_PROPERTY | OTHER

            $table->text('description');

            $table->string('status', 20)->default('OPEN');
            // OPEN | UNDER_REVIEW | RESOLVED | DISMISSED

            // Immediate actions taken when report is filed
            $table->boolean('account_restricted')->default(false);

            $table->uuid('reviewed_by')->nullable();
            $table->foreign('reviewed_by')->references('id')->on('users')->nullOnDelete();

            $table->text('review_notes')->nullable();

            // Confirms reporter acknowledged filing a false report is grounds for restriction
            $table->boolean('tos_acknowledged')->default(false);

            $table->timestampTz('reported_at')->useCurrent();
            $table->timestampTz('reviewed_at')->nullable();
        });

        DB::statement('CREATE INDEX idx_safety_reports_open ON safety_reports (status, reported_at)');
        DB::statement('CREATE INDEX idx_safety_reports_reported ON safety_reports (reported_id, status)');
    }

    public function down(): void
    {
        Schema::dropIfExists('safety_reports');
    }
};
