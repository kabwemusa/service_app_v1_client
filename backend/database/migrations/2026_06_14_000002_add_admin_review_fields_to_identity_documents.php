<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Admin-review fields for the Verification queue:
     *  - claim/assignment (concurrency guard so two reviewers don't act at once)
     *  - reviewer_admin_id — which admin_users record decided (reviewer_id stays
     *    FK→users for the legacy marketplace-admin path; the panel uses this one)
     *  - info_requested_at — represents the "needs info" state without adding a
     *    new DocStatus enum value (item stays MANUAL_REVIEW but is flagged).
     */
    public function up(): void
    {
        Schema::table('identity_documents', function (Blueprint $table) {
            $table->uuid('claimed_by_admin_id')->nullable();
            $table->timestamp('claimed_at')->nullable();
            $table->uuid('reviewer_admin_id')->nullable();
            $table->timestamp('info_requested_at')->nullable();

            $table->foreign('claimed_by_admin_id')
                ->references('id')->on('admin_users')->nullOnDelete();
            $table->foreign('reviewer_admin_id')
                ->references('id')->on('admin_users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('identity_documents', function (Blueprint $table) {
            $table->dropForeign(['claimed_by_admin_id']);
            $table->dropForeign(['reviewer_admin_id']);
            $table->dropColumn([
                'claimed_by_admin_id',
                'claimed_at',
                'reviewer_admin_id',
                'info_requested_at',
            ]);
        });
    }
};
