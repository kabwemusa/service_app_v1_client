<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Append-only audit log for every state-changing admin action.
     * This table must never be updated or deleted via the application.
     * See app/Services/AuditedMutationService.php for the only write path.
     */
    public function up(): void
    {
        Schema::create('admin_audit_log', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->uuid('actor_admin_id');
            $table->foreign('actor_admin_id')
                  ->references('id')->on('users')
                  ->onDelete('restrict'); // never cascade — preserve the audit trail

            $table->string('actor_role', 30);
            $table->string('action', 100);        // e.g. "user.ban", "dispute.resolve", "payout.override"
            $table->string('target_type', 80);    // e.g. "user", "booking", "dispute", "platform_param"
            $table->uuid('target_id');
            $table->text('reason');               // required; enforced by AuditedMutationService
            $table->jsonb('metadata')->default('{}'); // { before: {...}, after: {...} } — PII excluded
            $table->string('ip', 45);             // IPv4 or IPv6
            $table->text('user_agent');
            $table->timestamp('created_at')->useCurrent();
            // No updated_at — append-only

            $table->index(['actor_admin_id', 'created_at']);
            $table->index(['target_type', 'target_id']);
            $table->index('created_at');
            $table->index('action');
        });

        // Revoke UPDATE and DELETE at the database level so no application
        // code path can corrupt the trail, even with a bug or compromised account.
        // These GRANTs are idempotent — safe to run multiple times.
        DB::statement("REVOKE UPDATE, DELETE, TRUNCATE ON admin_audit_log FROM PUBLIC");
        DB::statement("REVOKE UPDATE, DELETE, TRUNCATE ON admin_audit_log FROM " . config('database.connections.pgsql.username'));
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_audit_log');
    }
};
