<?php

use App\Support\PhoneNumber;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * § SEC-8 — canonicalize every stored users.phone to E.164 so identity matching
 * can use strict equality (the old trailing-9-digits LIKE could resolve to a
 * different subscriber). After this runs, findOrCreateByPhone / OTP verify /
 * the WhatsApp resolver all match on exact E.164.
 *
 * Idempotent and collision-safe: a row whose normalized number already belongs
 * to another account is left untouched and logged for manual reconciliation
 * rather than violating the unique(phone) constraint.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('users')
            ->whereNotNull('phone')
            ->orderBy('id')
            ->chunkById(500, function ($users) {
                foreach ($users as $u) {
                    $e164 = PhoneNumber::normalize($u->phone);

                    if ($e164 === null || $e164 === $u->phone) {
                        continue;
                    }

                    $clash = DB::table('users')
                        ->where('phone', $e164)
                        ->where('id', '!=', $u->id)
                        ->exists();

                    if ($clash) {
                        Log::warning('phone-backfill: skipped — normalized number already in use', [
                            'user_id' => $u->id, 'raw' => $u->phone, 'e164' => $e164,
                        ]);
                        continue;
                    }

                    DB::table('users')->where('id', $u->id)->update(['phone' => $e164]);
                }
            });
    }

    public function down(): void
    {
        // Non-reversible: the pre-normalization representations are not retained.
    }
};
