<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('disputes', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('booking_id')->unique();
            $table->foreign('booking_id')->references('id')->on('bookings')->onDelete('cascade');

            $table->uuid('raised_by');
            $table->foreign('raised_by')->references('id')->on('users');
            $table->uuid('against');
            $table->foreign('against')->references('id')->on('users');

            $table->string('reason_category', 20);
            // NOT_DELIVERED | QUALITY_ISSUE | WRONG_ITEM | DAMAGE | NO_SHOW | SAFETY | OTHER

            $table->text('description');
            $table->jsonb('evidence')->default('[]');  // S3 keys for photos, receipts

            $table->string('status', 25)->default('OPEN');
            // OPEN | UNDER_REVIEW | AWAITING_EVIDENCE | RESOLVED_BUYER | RESOLVED_PROVIDER | RESOLVED_PARTIAL | WITHDRAWN

            $table->text('resolution_notes')->nullable();
            $table->decimal('refund_amount', 10, 2)->nullable();  // supports partial refunds

            $table->uuid('resolved_by')->nullable();
            $table->foreign('resolved_by')->references('id')->on('users')->nullOnDelete();

            $table->timestamp('opened_at')->useCurrent();
            $table->timestamp('resolved_at')->nullable();
        });

        DB::statement('CREATE INDEX idx_disputes_queue ON disputes USING btree (status, opened_at)');
    }

    public function down(): void
    {
        Schema::dropIfExists('disputes');
    }
};
