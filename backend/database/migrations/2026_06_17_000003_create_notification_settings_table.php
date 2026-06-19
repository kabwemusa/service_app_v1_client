<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notification_settings', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('user_id')->unique();
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->jsonb('categories');
            $table->jsonb('quiet_hours');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notification_settings');
    }
};
