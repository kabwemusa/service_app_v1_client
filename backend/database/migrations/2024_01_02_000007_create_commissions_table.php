<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commissions', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('booking_id')->unique();
            $table->foreign('booking_id')->references('id')->on('bookings')->onDelete('cascade');

            $table->uuid('provider_id');
            $table->foreign('provider_id')->references('id')->on('users');
            $table->unsignedInteger('category_id');
            $table->foreign('category_id')->references('id')->on('categories');

            $table->decimal('gross_amount', 10, 2);
            $table->decimal('commission_rate', 4, 4);           // e.g. 0.1200 = 12%
            $table->decimal('commission_amount', 10, 2);
            $table->decimal('payment_processor_fee', 10, 2)->default(0.00);  // pass-through
            $table->decimal('vat', 10, 2)->default(0.00);       // 16% on commission if applicable
            $table->decimal('net_to_provider', 10, 2);

            $table->unsignedTinyInteger('tier_at_time');        // snapshot of trust tier
            $table->string('promo_code')->nullable();

            $table->timestamp('calculated_at')->useCurrent();
        });

        DB::statement('CREATE INDEX idx_commissions_provider ON commissions USING btree (provider_id)');
        DB::statement('CREATE INDEX idx_commissions_report ON commissions USING btree (calculated_at, category_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('commissions');
    }
};
