<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('promoted_slots', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->uuid('provider_id');
            $table->foreign('provider_id')->references('id')->on('users')->onDelete('cascade');
            $table->unsignedInteger('category_id');
            $table->foreign('category_id')->references('id')->on('categories');
            $table->string('region', 60);

            $table->decimal('bid_amount_per_day', 10, 2);

            $table->timestamp('starts_at');
            $table->timestamp('ends_at');

            $table->string('status', 10)->default('ACTIVE'); // ACTIVE | PAUSED | EXPIRED

            // Performance counters
            $table->unsignedInteger('impressions')->default(0);
            $table->unsignedInteger('clicks')->default(0);
            $table->unsignedInteger('bookings_sourced')->default(0);
        });

        DB::statement('CREATE INDEX idx_promoted_active ON promoted_slots USING btree (status, category_id, region, ends_at)');
    }

    public function down(): void
    {
        Schema::dropIfExists('promoted_slots');
    }
};
