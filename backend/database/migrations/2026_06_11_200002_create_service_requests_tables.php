<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * v3.2 §6 — post-a-request (reverse flow).
 *
 *  - service_requests: the buyer's broadcast (category, description ≤ 500,
 *    delivery location, time window, optional budget).
 *  - service_request_targets: the top-10 providers notified, with response
 *    timestamps — the 30-minute deadline feeds response_rate_7d.
 *  - service_request_responses: accept-at-listed-price or quote (reuses the
 *    §5.5 QUOTE semantics); buyer selects one; downstream booking/escrow
 *    is the unchanged standard flow.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_requests', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->uuid('buyer_id');
            $table->foreign('buyer_id')->references('id')->on('users')->onDelete('cascade');
            $table->unsignedInteger('category_id');
            $table->foreign('category_id')->references('id')->on('categories');

            $table->string('description', 500);

            $table->string('delivery_location_label')->nullable();
            $table->string('delivery_location_region', 60)->nullable();
            $table->string('delivery_location_source', 10)->nullable(); // DEVICE | SEARCH | SAVED

            $table->timestamp('window_start');
            $table->timestamp('window_end');
            $table->decimal('budget_zmw', 10, 2)->nullable();

            $table->string('status', 10)->default('OPEN');
            // OPEN | MATCHED | EXPIRED | CANCELLED

            $table->timestamps();
        });

        DB::statement('ALTER TABLE service_requests ADD COLUMN delivery_location geography(Point, 4326)');
        DB::statement("ALTER TABLE service_requests ADD CONSTRAINT service_requests_status_check
            CHECK (status IN ('OPEN', 'MATCHED', 'EXPIRED', 'CANCELLED'))");
        DB::statement('CREATE INDEX idx_service_requests_open ON service_requests USING btree (status, window_end)');
        DB::statement('CREATE INDEX idx_service_requests_buyer ON service_requests USING btree (buyer_id, created_at)');

        Schema::create('service_request_targets', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->uuid('request_id');
            $table->foreign('request_id')->references('id')->on('service_requests')->onDelete('cascade');
            $table->uuid('provider_id');
            $table->foreign('provider_id')->references('id')->on('users')->onDelete('cascade');
            $table->uuid('service_id');
            $table->foreign('service_id')->references('id')->on('services')->onDelete('cascade');

            $table->timestamp('notified_at')->useCurrent();
            // The 30-minute response deadline; responded_at vs this feeds response_rate_7d
            $table->timestamp('respond_by');
            $table->timestamp('responded_at')->nullable();

            $table->unique(['request_id', 'provider_id']);
        });

        DB::statement('CREATE INDEX idx_request_targets_provider ON service_request_targets USING btree (provider_id, notified_at)');

        Schema::create('service_request_responses', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->uuid('request_id');
            $table->foreign('request_id')->references('id')->on('service_requests')->onDelete('cascade');
            $table->uuid('provider_id');
            $table->foreign('provider_id')->references('id')->on('users')->onDelete('cascade');
            $table->uuid('service_id');
            $table->foreign('service_id')->references('id')->on('services')->onDelete('cascade');

            $table->string('type', 10); // ACCEPT (at listed price) | QUOTE
            $table->decimal('price_zmw', 10, 2);
            $table->string('message', 300)->nullable();

            $table->string('status', 10)->default('PENDING'); // PENDING | SELECTED | DECLINED

            $table->timestamp('created_at')->useCurrent();

            $table->unique(['request_id', 'provider_id']);
        });

        DB::statement("ALTER TABLE service_request_responses ADD CONSTRAINT service_request_responses_type_check
            CHECK (type IN ('ACCEPT', 'QUOTE'))");

        // The notifications enum predates this flow — admit the new type.
        DB::statement('ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check');
        DB::statement("ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
            CHECK (type IN ('BOOKING_REQUEST','BOOKING_ACCEPTED','PAYMENT_CONFIRMED','JOB_STARTED','JOB_DELIVERED',
                            'DISPUTE_RAISED','PAYOUT_SENT','KYC_APPROVED','KYC_REJECTED','SERVICE_REQUEST'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('service_request_responses');
        Schema::dropIfExists('service_request_targets');
        Schema::dropIfExists('service_requests');

        DB::statement('ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check');
        DB::statement("ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
            CHECK (type IN ('BOOKING_REQUEST','BOOKING_ACCEPTED','PAYMENT_CONFIRMED','JOB_STARTED','JOB_DELIVERED',
                            'DISPUTE_RAISED','PAYOUT_SENT','KYC_APPROVED','KYC_REJECTED'))");
    }
};
