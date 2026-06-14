<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * v3.2 §7 — ranking instrumentation. Append-only:
 *
 *  - search_impressions: one row per served search — query context plus the
 *    ordered result list with each result's full score-component breakdown.
 *    "Why was X above Y at 14:32?" becomes answerable from one row, and this
 *    is the future training data.
 *  - search_impression_events: result_clicked / booking_started referencing
 *    the impression.
 *  - metric_snapshots: weekly north-star metrics written by metrics:weekly,
 *    read by the Next.js admin.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('search_impressions', function (Blueprint $table) {
            $table->uuid('id')->primary();

            $table->uuid('user_id')->nullable();
            $table->unsignedInteger('category_id')->nullable();
            $table->string('geohash5', 5)->nullable();
            $table->timestamp('requested_at');

            // Ordered array of {provider_id, service_id, placement, score, components{...}}
            $table->jsonb('results');
        });

        DB::statement('CREATE INDEX idx_impressions_requested ON search_impressions USING btree (requested_at)');
        DB::statement('CREATE INDEX idx_impressions_category ON search_impressions USING btree (category_id, requested_at)');

        Schema::create('search_impression_events', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->uuid('impression_id');
            $table->foreign('impression_id')->references('id')->on('search_impressions')->onDelete('cascade');

            $table->string('event_type', 20); // RESULT_CLICKED | BOOKING_STARTED
            $table->uuid('service_id')->nullable();
            $table->uuid('provider_id')->nullable();

            $table->timestamp('created_at')->useCurrent();
        });

        DB::statement("ALTER TABLE search_impression_events ADD CONSTRAINT search_impression_events_type_check
            CHECK (event_type IN ('RESULT_CLICKED', 'BOOKING_STARTED'))");
        DB::statement('CREATE INDEX idx_impression_events ON search_impression_events USING btree (impression_id, event_type)');

        Schema::create('metric_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->string('metric', 50);
            $table->date('period_start');
            $table->date('period_end');
            $table->decimal('value', 14, 4)->nullable();
            $table->jsonb('dimensions')->nullable(); // e.g. {"category_id": 3}

            $table->timestamp('created_at')->useCurrent();

            $table->index(['metric', 'period_start']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('metric_snapshots');
        Schema::dropIfExists('search_impression_events');
        Schema::dropIfExists('search_impressions');
    }
};
