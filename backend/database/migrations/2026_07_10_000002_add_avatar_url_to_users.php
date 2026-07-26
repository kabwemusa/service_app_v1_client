<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Customer-facing profile photo. Providers already have one on
 * provider_profiles.avatar_url — this is the equivalent for every account
 * (customer or provider), shown wherever the account's own identity renders
 * (Profile screen). Public storage — never the KYC selfie.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('avatar_url')->nullable()->after('legal_name');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('avatar_url');
        });
    }
};
