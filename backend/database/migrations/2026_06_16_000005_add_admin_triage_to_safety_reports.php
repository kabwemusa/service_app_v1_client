<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Admin Safety module (§11.3) — triage bookkeeping for the panel.
 *
 * The base safety_reports table (2024_01_04) carries the consumer-filed report
 * and the legacy in-app moderator review (reviewed_by → users). These columns
 * add what the admin-panel triage workflow needs that the base table cannot
 * express:
 *   - severity:             severity-first queue ordering. EMERGENCY is reserved
 *                           for emergency_events; reports are HIGH or STANDARD.
 *   - assigned_admin_id:    claim → "investigating by {admin}" (→ admin_users).
 *   - contact_restricted:   protective action — block contact between parties.
 *   - authority_escalated:  the admin RECORDS a decision to escalate to authorities;
 *                           the system never contacts them itself (§ confidentiality).
 *   - super_admin_escalated: bumped to super_admin for sign-off.
 *   - reviewed_by_admin_id: admin who resolved (distinct from legacy reviewed_by).
 *   - outcome:              resolution outcome category.
 *
 * Free-text reasons and case notes live in admin_audit_log (the drawer's audit
 * trail), so no reason/notes column is duplicated here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('safety_reports', function (Blueprint $table) {
            $table->string('severity', 10)->default('STANDARD')->after('category');
            // HIGH | STANDARD  (EMERGENCY lives in emergency_events)

            $table->uuid('assigned_admin_id')->nullable()->after('status');
            $table->foreign('assigned_admin_id')->references('id')->on('admin_users')->nullOnDelete();
            $table->timestampTz('assigned_at')->nullable()->after('assigned_admin_id');

            $table->boolean('contact_restricted')->default(false)->after('account_restricted');

            $table->timestampTz('authority_escalated_at')->nullable()->after('contact_restricted');
            $table->boolean('super_admin_escalated')->default(false)->after('authority_escalated_at');

            $table->uuid('reviewed_by_admin_id')->nullable()->after('reviewed_by');
            $table->foreign('reviewed_by_admin_id')->references('id')->on('admin_users')->nullOnDelete();

            $table->string('outcome', 30)->nullable()->after('review_notes');
            // ACTION_TAKEN | NO_ACTION | REFERRED | DUPLICATE  (free outcome category)
        });

        // Backfill severity: a credible violence/threat report is HIGH, the rest STANDARD.
        DB::table('safety_reports')->where('category', 'VIOLENCE_THREAT')->update(['severity' => 'HIGH']);

        DB::statement('CREATE INDEX idx_safety_reports_severity ON safety_reports (severity, reported_at)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_safety_reports_severity');

        Schema::table('safety_reports', function (Blueprint $table) {
            $table->dropForeign(['assigned_admin_id']);
            $table->dropForeign(['reviewed_by_admin_id']);
            $table->dropColumn([
                'severity', 'assigned_admin_id', 'assigned_at',
                'contact_restricted', 'authority_escalated_at', 'super_admin_escalated',
                'reviewed_by_admin_id', 'outcome',
            ]);
        });
    }
};
