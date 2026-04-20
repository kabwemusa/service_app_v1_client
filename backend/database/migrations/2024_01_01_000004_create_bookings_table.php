<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bookings', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('buyer_id');
            $table->foreign('buyer_id')->references('id')->on('users');
            $table->uuid('provider_id');
            $table->foreign('provider_id')->references('id')->on('users');
            $table->uuid('service_id');
            $table->foreign('service_id')->references('id')->on('services');
            $table->enum('status', [
                'PENDING_PAYMENT',
                'FUNDS_HELD',
                'IN_PROGRESS',
                'DELIVERED',
                'COMPLETED',
                'DISPUTED',
                'CANCELLED',
            ])->default('PENDING_PAYMENT');
            $table->timestampTz('scheduled_start');
            $table->timestampTz('scheduled_end');
            $table->text('dispute_reason')->nullable();
            $table->timestamps();
        });

        // PostGIS geography column for delivery location
        DB::statement('ALTER TABLE bookings ADD COLUMN delivery_location geography(Point, 4326)');

        // Critical composite index for the conflict algorithm
        DB::statement('CREATE INDEX idx_bookings_provider_status_start ON bookings USING btree (provider_id, status, scheduled_start)');
        DB::statement('CREATE INDEX idx_bookings_buyer ON bookings USING btree (buyer_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('bookings');
    }
};
