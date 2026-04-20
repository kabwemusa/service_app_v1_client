<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('provider_profiles', function (Blueprint $table) {
            $table->uuid('user_id')->primary();
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->string('nrc_number')->unique()->nullable();
            $table->string('student_id_url')->nullable();
            $table->enum('kyc_status', ['PENDING', 'VERIFIED', 'REJECTED'])->default('PENDING');
            $table->enum('momo_provider', ['MTN', 'AIRTEL', 'ZAMTEL'])->nullable();
            $table->string('momo_number')->nullable();
            $table->decimal('base_location_lat', 10, 8)->nullable();
            $table->decimal('base_location_lng', 11, 8)->nullable();
            $table->integer('max_radius_km')->default(5);
            $table->jsonb('availability_matrix')->default('{}');
            $table->integer('profile_completeness')->default(0);
            $table->timestamps();
        });

        DB::statement('CREATE INDEX idx_provider_kyc ON provider_profiles USING btree (kyc_status)');
    }

    public function down(): void
    {
        Schema::dropIfExists('provider_profiles');
    }
};
