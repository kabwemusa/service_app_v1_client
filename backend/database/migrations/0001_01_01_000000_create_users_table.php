<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Enable PostGIS & UUID extensions
        DB::statement('CREATE EXTENSION IF NOT EXISTS postgis');
        DB::statement('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

        Schema::create('users', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('email')->unique();
            $table->string('password_hash');
            $table->enum('role', ['CUSTOMER', 'PROVIDER', 'ADMIN'])->default('CUSTOMER');
            $table->boolean('is_verified')->default(false);
            $table->integer('v_reviews')->default(0);
            $table->decimal('r_raw', 3, 2)->default(0.00);
            $table->decimal('completion_rate', 3, 2)->default(1.00);
            $table->timestamp('last_active_at')->nullable();
            $table->timestamps();
        });

        DB::statement('CREATE INDEX idx_users_role ON users USING btree (role)');

        // Sessions table (needed for Redis session driver fallback)
        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->uuid('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sessions');
        Schema::dropIfExists('users');
    }
};
