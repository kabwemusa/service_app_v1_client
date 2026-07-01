<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversation_states', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('whatsapp_id', 20)->unique();
            $table->uuid('user_id')->nullable();
            $table->string('state', 30)->default('MENU');
            $table->string('sub_state', 50)->nullable();
            $table->jsonb('context')->default('{}');
            $table->uuid('booking_id')->nullable();
            $table->timestamp('last_inbound_at')->nullable();
            $table->timestamp('timeout_at')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
            $table->foreign('booking_id')->references('id')->on('bookings')->nullOnDelete();
            $table->index('state');
            $table->index('timeout_at');
        });

        Schema::create('processed_messages', function (Blueprint $table) {
            $table->string('message_id', 64)->primary();
            $table->timestamp('processed_at')->useCurrent();
            $table->index('processed_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('processed_messages');
        Schema::dropIfExists('conversation_states');
    }
};
