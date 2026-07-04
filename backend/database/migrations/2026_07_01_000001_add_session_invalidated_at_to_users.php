<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Revocation watermark for immediate session invalidation on ban/suspend.
 *
 * The access token (JWT) is stateless and short-lived but not instantly
 * revocable by itself. On ban/suspend the admin action sets this column to
 * now(); EnsureAccountActive rejects any token whose `iat` claim predates it,
 * so every active session is cut within one request regardless of the
 * token's remaining TTL. Refresh tokens are revoked separately in Redis.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('session_invalidated_at')->nullable()->after('suspended_until');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('session_invalidated_at');
        });
    }
};
