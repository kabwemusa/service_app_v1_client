<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * v3.2 §1.5 — auction reserve prices per category × region.
 *
 * In a thin market the §8.5 second-price auction frequently has a single
 * bidder who would otherwise pay ~0. The reserve (default: 5% of the
 * category-region median booking value, recomputed weekly by
 * promoted:recompute-reserves) is the price a single bidder pays and the
 * floor below which bids are ignored.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('promoted_slot_reserves', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->unsignedInteger('category_id');
            $table->foreign('category_id')->references('id')->on('categories');
            $table->string('region', 60);

            $table->decimal('reserve_per_day', 10, 2);
            $table->decimal('median_booking_value', 10, 2)->nullable();
            $table->timestamp('computed_at');

            $table->unique(['category_id', 'region']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('promoted_slot_reserves');
    }
};
