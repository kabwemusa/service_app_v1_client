<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('services', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('provider_id');
            $table->foreign('provider_id')->references('id')->on('users')->onDelete('cascade');
            $table->unsignedInteger('category_id');
            $table->foreign('category_id')->references('id')->on('categories');
            $table->string('title', 100);
            $table->text('description')->nullable();
            $table->decimal('base_price', 10, 2);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // PostGIS geography column for spatial queries
        DB::statement('ALTER TABLE services ADD COLUMN service_location geography(Point, 4326)');
        DB::statement('CREATE INDEX idx_services_location ON services USING GIST (service_location)');
        DB::statement('CREATE INDEX idx_services_category ON services USING btree (category_id)');
        DB::statement('CREATE INDEX idx_services_provider ON services USING btree (provider_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('services');
    }
};
