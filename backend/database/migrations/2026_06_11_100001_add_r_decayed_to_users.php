<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * v3.2 §4.2 — recency-decayed rating. Computed nightly (weight =
 * 0.5^(age_days/180)); feeds R_bayes and ranking so improving providers can
 * visibly recover and coasting veterans can't live on old reviews. NULL until
 * the provider has reviews. The all-time r_raw stays on the public profile.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->decimal('r_decayed', 3, 2)->nullable()->after('r_raw');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('r_decayed');
        });
    }
};
