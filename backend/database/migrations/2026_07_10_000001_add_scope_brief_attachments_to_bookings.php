<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Photos / a short video the customer attaches to a quote-first brief
 * (PROVIDER_SCOPE / QUOTE_DEPOSIT) so the provider has visual context to price
 * the job — the same idea as the text Q&A brief, just media instead of words.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->jsonb('scope_brief_attachments')->nullable()->default('[]')->after('scope_brief');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn('scope_brief_attachments');
        });
    }
};
