<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Workflow state for the Fraud module's Patterns/Escalations tabs.
 *
 * Fraud signals themselves (review bombing, repeated failed payments, etc.)
 * are computed live from existing tables (reviews, review_flags,
 * safety_reports, payment attempts) — never invented or stored twice. This
 * table only tracks what an admin DID about a given signal instance
 * (claimed / investigating / escalated / false positive), since the signal
 * itself has no natural row to attach that state to.
 *
 * `signal_key` identifies one signal instance deterministically, e.g.
 * "review_spike:{provider_id}:{date}" or "safety_report:{report_id}" — so
 * re-detecting the same signal reuses the same workflow row (idempotent).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fraud_signal_reviews', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('signal_type', 40); // REVIEW_SPIKE | FAILED_PAYMENTS | MULTI_ACCOUNT_DEVICE | RAPID_REREGISTRATION | SAFETY_ESCALATION
            $table->string('signal_key', 150)->unique();
            $table->string('severity', 20); // LOW | MEDIUM | HIGH
            $table->jsonb('affected_users'); // [{id, label}] — resolved at read time, not raw PII
            $table->string('source_module', 20)->nullable(); // reviews | safety | services | null (fraud-native)
            $table->string('source_id', 100)->nullable();
            $table->string('status', 20)->default('open'); // open | investigating | escalated | false_positive | resolved
            $table->uuid('assigned_admin_id')->nullable();
            $table->timestamp('detected_at');
            $table->timestamps();

            $table->foreign('assigned_admin_id')->references('id')->on('admin_users')->nullOnDelete();
            $table->index(['status', 'severity']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fraud_signal_reviews');
    }
};
