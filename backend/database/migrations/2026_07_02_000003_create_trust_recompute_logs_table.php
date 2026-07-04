<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Passive, append-only log of provider trust_score recomputes. Written from
 * ComputeTrustScoreJob (the nightly batch — reason='scheduled') at the point
 * it already updates provider_profiles.trust_score — no behavior change,
 * purely observability for the admin Dispatch & Trust Insights module.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trust_recompute_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('provider_id');
            $table->string('reason', 20); // scheduled | dispute | review | manual
            $table->decimal('old_score', 5, 2)->nullable();
            $table->decimal('new_score', 5, 2);
            $table->timestamp('created_at');

            $table->foreign('provider_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index(['provider_id', 'created_at']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trust_recompute_logs');
    }
};
