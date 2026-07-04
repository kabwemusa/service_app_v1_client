<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Generic key-value settings store for the admin Platform Settings module.
 *
 * Scope is intentionally tight: this is a read/override store for the
 * specific fields the Settings UI edits (see PlatformSettingsService). It is
 * NOT a general feature-flag system. Every key belongs to one of the four
 * Settings tabs (`group`), and every write is audited by the caller via
 * AuditedMutationService — this table only holds current values, the
 * audit trail lives in admin_audit_log as with every other module.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('platform_settings', function (Blueprint $table) {
            $table->string('key', 100)->primary();
            $table->string('group', 30); // general | dispatch | verification | alerts
            $table->jsonb('value');
            $table->uuid('updated_by')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();

            $table->foreign('updated_by')->references('id')->on('admin_users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_settings');
    }
};
