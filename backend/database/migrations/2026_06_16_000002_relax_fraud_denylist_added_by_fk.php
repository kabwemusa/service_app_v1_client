<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Denylist additions now come from the admin panel, where the actor is an
 * `admin_users` row — not a marketplace `users` row. The original
 * `fraud_denylist.added_by → users.id` foreign key would reject those inserts.
 *
 * Mirrors what 2026_06_14_000001 did for admin_audit_log.actor_admin_id: drop
 * the cross-table FK and keep `added_by` as a plain UUID that holds the admin id.
 */
return new class extends Migration
{
    public function up(): void
    {
        // The constraint may already be gone in some environments — guard it.
        DB::statement('ALTER TABLE fraud_denylist DROP CONSTRAINT IF EXISTS fraud_denylist_added_by_foreign');
    }

    public function down(): void
    {
        // Best-effort restore; only valid if all existing added_by values map to users.
        Schema::table('fraud_denylist', function (Blueprint $table) {
            $table->foreign('added_by')->references('id')->on('users');
        });
    }
};
