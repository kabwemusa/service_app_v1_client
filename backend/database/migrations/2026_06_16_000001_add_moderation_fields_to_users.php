<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Admin Users module — moderation bookkeeping.
 *
 * `account_state` (ACTIVE/RESTRICTED/SUSPENDED/BANNED/PENDING_CLOSURE) already
 * carries the hard lifecycle state. These two columns add the metadata the
 * moderation actions need that the enum cannot express:
 *   - warned_at:      a "warn" is a notice, NOT a state change. Setting this lets
 *                     the panel surface a derived "warned" badge while the account
 *                     stays ACTIVE. Cleared on reinstate.
 *   - suspended_until: a suspend is TEMPORARY; this records when it lapses so the
 *                     panel can show "suspended until X". Null for an open-ended
 *                     suspension. Cleared on reinstate/ban.
 *
 * The free-text reason for every action lives in admin_audit_log (the source of
 * truth surfaced in the drawer's audit trail), so no reason column is duplicated
 * here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('warned_at')->nullable()->after('disputes_raised_30d');
            $table->timestamp('suspended_until')->nullable()->after('warned_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['warned_at', 'suspended_until']);
        });
    }
};
