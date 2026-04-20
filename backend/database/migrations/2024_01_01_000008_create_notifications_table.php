<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('user_id');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->enum('type', [
                'BOOKING_REQUEST',
                'BOOKING_ACCEPTED',
                'PAYMENT_CONFIRMED',
                'JOB_STARTED',
                'JOB_DELIVERED',
                'DISPUTE_RAISED',
                'PAYOUT_SENT',
                'KYC_APPROVED',
                'KYC_REJECTED',
            ]);
            $table->string('title');
            $table->string('body');
            $table->boolean('is_read')->default(false);
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
        });

        DB::statement('CREATE INDEX idx_notifications_user_read ON notifications USING btree (user_id, is_read)');
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
