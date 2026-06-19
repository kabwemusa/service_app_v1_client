<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Drop the restrictive enum check constraint + widen column to plain varchar
        DB::statement("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check");
        DB::statement("ALTER TABLE notifications ALTER COLUMN type TYPE varchar(50)");

        Schema::table('notifications', function (Blueprint $table) {
            $table->timestamp('read_at')->nullable()->after('body');
            $table->string('entity_type', 30)->nullable()->after('read_at');
            $table->uuid('entity_id')->nullable()->after('entity_type');
            $table->string('payment_mode', 10)->nullable()->after('entity_id');
            $table->jsonb('meta')->nullable()->after('payment_mode');
        });

        // Migrate existing is_read boolean → read_at timestamp
        DB::statement("UPDATE notifications SET read_at = updated_at WHERE is_read = true");

        Schema::table('notifications', function (Blueprint $table) {
            $table->dropColumn('is_read');
        });

        // Composite index for inbox queries (user + unread, newest first)
        DB::statement('CREATE INDEX idx_notifications_inbox ON notifications (user_id, read_at NULLS FIRST, created_at DESC)');
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->boolean('is_read')->default(false);
        });

        DB::statement("UPDATE notifications SET is_read = true WHERE read_at IS NOT NULL");

        Schema::table('notifications', function (Blueprint $table) {
            $table->dropColumn(['read_at', 'entity_type', 'entity_id', 'payment_mode', 'meta']);
        });

        DB::statement('DROP INDEX IF EXISTS idx_notifications_inbox');
    }
};
