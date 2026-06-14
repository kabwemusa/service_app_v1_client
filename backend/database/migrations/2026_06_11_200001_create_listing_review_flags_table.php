<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * v3.2 §1.7 — quality/fraud review queue for listings.
 *
 * Prices below 0.5 × the category-region median never boost rank; they land
 * here instead (lowball listings are a known scam vector and a circumvention
 * bait pattern). Admin-reviewed; one open flag per (service, reason).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('listing_review_flags', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->uuid('service_id');
            $table->foreign('service_id')->references('id')->on('services')->onDelete('cascade');
            $table->uuid('provider_id');
            $table->foreign('provider_id')->references('id')->on('users')->onDelete('cascade');

            $table->string('reason', 30); // LOWBALL_PRICE | ...
            $table->jsonb('details')->nullable();

            $table->string('status', 15)->default('OPEN'); // OPEN | REVIEWED | DISMISSED
            $table->uuid('reviewed_by')->nullable();
            $table->timestamp('reviewed_at')->nullable();

            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('updated_at')->useCurrent();

            $table->unique(['service_id', 'reason']);
        });

        DB::statement('CREATE INDEX idx_listing_flags_open ON listing_review_flags USING btree (status, created_at)');
    }

    public function down(): void
    {
        Schema::dropIfExists('listing_review_flags');
    }
};
