<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Phone-first identity (TRANSFORMATION_PLAN — identity rule).
 *
 * Phone becomes the canonical account key, with passwordless phone-OTP as the
 * primary auth path. Accounts created via the PWA sign-in sheet or resolved from
 * a WhatsApp number have neither an email nor a password, so both columns must
 * be nullable. (Postgres UNIQUE on `email` already permits multiple NULLs.)
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE users ALTER COLUMN email DROP NOT NULL');
        DB::statement('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL');
    }

    public function down(): void
    {
        // Backfill placeholders so the NOT NULL constraint can be restored on
        // any phone-only rows created in the meantime.
        DB::statement("UPDATE users SET email = id || '@placeholder.invalid' WHERE email IS NULL");
        DB::statement("UPDATE users SET password_hash = '' WHERE password_hash IS NULL");
        DB::statement('ALTER TABLE users ALTER COLUMN email SET NOT NULL');
        DB::statement('ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL');
    }
};
