<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Admin actors live in `admin_users`, not `users`. The audit-log FK was
     * originally pointed at `users`; re-point it now that the admin identity
     * table exists. Runs after both tables are created, so it is safe whether
     * the DB was migrated before or is being built fresh.
     */
    public function up(): void
    {
        if (! Schema::hasTable('admin_audit_log') || ! Schema::hasColumn('admin_audit_log', 'actor_admin_id')) {
            return;
        }

        Schema::table('admin_audit_log', function (Blueprint $table) {
            // Drop the original FK → users (named by Laravel convention).
            try {
                $table->dropForeign(['actor_admin_id']);
            } catch (\Throwable $e) {
                // FK may not exist (e.g. partial state) — proceed to re-create.
            }
        });

        Schema::table('admin_audit_log', function (Blueprint $table) {
            $table->foreign('actor_admin_id')
                ->references('id')->on('admin_users')
                ->onDelete('restrict'); // never cascade — preserve the audit trail
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('admin_audit_log')) {
            return;
        }

        Schema::table('admin_audit_log', function (Blueprint $table) {
            try {
                $table->dropForeign(['actor_admin_id']);
            } catch (\Throwable $e) {
                // ignore
            }
        });

        Schema::table('admin_audit_log', function (Blueprint $table) {
            $table->foreign('actor_admin_id')
                ->references('id')->on('users')
                ->onDelete('restrict');
        });
    }
};
