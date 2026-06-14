<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * v3.2 §4.1 cold-start fix — `users.completion_rate` defaulted to 1.00, which
 * made an unknown provider look like one with a perfect record. NULL now means
 * "no data", distinct from an earned 100%. Ranking and trust use the shrunk
 * rate computed from bookings, never this raw column.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE users ALTER COLUMN completion_rate DROP NOT NULL');
        DB::statement('ALTER TABLE users ALTER COLUMN completion_rate SET DEFAULT NULL');

        // Existing rows still on the untouched 1.00 default with no provider
        // history never earned that record — reset them to "no data".
        DB::statement("
            UPDATE users u
            SET    completion_rate = NULL
            WHERE  u.completion_rate = 1.00
              AND  NOT EXISTS (
                   SELECT 1 FROM bookings b
                   WHERE  b.provider_id = u.id
                     AND  b.status IN ('COMPLETED', 'CANCELLED')
              )
        ");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users ALTER COLUMN completion_rate SET DEFAULT 1.00');
        DB::statement('UPDATE users SET completion_rate = 1.00 WHERE completion_rate IS NULL');
        DB::statement('ALTER TABLE users ALTER COLUMN completion_rate SET NOT NULL');
    }
};
