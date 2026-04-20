<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('messages', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('booking_id');
            $table->foreign('booking_id')->references('id')->on('bookings');
            $table->uuid('sender_id');
            $table->foreign('sender_id')->references('id')->on('users');
            $table->text('content');
            $table->boolean('is_redacted')->default(false);
            $table->decimal('risk_score', 3, 2)->default(0.00);
            $table->timestamps();
        });

        DB::statement('CREATE INDEX idx_messages_booking ON messages USING btree (booking_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
    }
};
