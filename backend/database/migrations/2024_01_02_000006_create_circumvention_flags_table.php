<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('circumvention_flags', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('user_id');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->uuid('counterparty_id');
            $table->foreign('counterparty_id')->references('id')->on('users')->onDelete('cascade');
            $table->uuid('booking_id')->nullable();
            $table->foreign('booking_id')->references('id')->on('bookings')->nullOnDelete();

            $table->string('signal_type', 40);
            // PHONE_IN_MESSAGE | EMAIL_IN_MESSAGE | SOCIAL_HANDLE | OFF_PLATFORM_KEYWORD
            // REPEATED_PAIR_NO_BOOKING | QUICK_DISENGAGE

            $table->text('raw_context');  // the message or action that triggered the flag
            $table->decimal('severity', 3, 2)->default(0.00);

            $table->string('action_taken', 15)->default('NONE');
            // REDACTED | WARNED | RESTRICTED | NONE

            $table->timestamp('created_at')->useCurrent();
        });

        DB::statement('CREATE INDEX idx_circ_user ON circumvention_flags USING btree (user_id, created_at)');
        DB::statement('CREATE INDEX idx_circ_pair ON circumvention_flags USING btree (counterparty_id, user_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('circumvention_flags');
    }
};
