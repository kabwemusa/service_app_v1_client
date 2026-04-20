<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('transactions', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('booking_id');
            $table->foreign('booking_id')->references('id')->on('bookings');
            $table->string('momo_reference')->unique(); // idempotency key
            $table->decimal('amount_gross', 10, 2);
            $table->decimal('platform_fee', 10, 2);
            $table->decimal('amount_net', 10, 2);
            $table->enum('type', ['PAY_IN', 'PAY_OUT', 'REFUND']);
            $table->enum('status', ['PENDING', 'SUCCESS', 'FAILED'])->default('PENDING');
            $table->integer('retry_count')->default(0);
            $table->timestampTz('next_retry_at')->nullable();
            $table->timestamps();
        });

        // Index for retry worker: find FAILED transactions due for retry
        DB::statement("CREATE INDEX idx_transactions_retry ON transactions USING btree (status, next_retry_at) WHERE status = 'FAILED'");
        // Index for booking lookup
        DB::statement('CREATE INDEX idx_transactions_booking ON transactions USING btree (booking_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('transactions');
    }
};
