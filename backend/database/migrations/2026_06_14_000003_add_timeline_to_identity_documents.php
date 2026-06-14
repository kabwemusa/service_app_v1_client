<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Per-submission progression log: an ordered array of status transitions
     * (submitted, auto-checks, manual review, info requested, resubmitted,
     * approved/rejected) shown in the admin detail drawer so reviewers can see
     * how an application has moved. PII-free — statuses, actors and notes only.
     */
    public function up(): void
    {
        Schema::table('identity_documents', function (Blueprint $table) {
            $table->jsonb('timeline')->default('[]');
        });
    }

    public function down(): void
    {
        Schema::table('identity_documents', function (Blueprint $table) {
            $table->dropColumn('timeline');
        });
    }
};
