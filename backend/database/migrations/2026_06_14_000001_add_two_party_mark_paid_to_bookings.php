<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two-party "mark as paid" for DIRECT bookings.
 *
 * The original DIRECT migration tracked a single informational `payment_status`
 * + `payment_marked_by`. The provider booking-detail screen needs to reflect
 * *partial* settlement — "you marked paid · awaiting customer" — and only treat
 * a booking as fully settled when BOTH parties confirm. These two additive,
 * nullable timestamps record each side independently. `payment_status` keeps its
 * existing "at least one side marked" meaning so existing surfaces are untouched.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->timestampTz('provider_marked_paid_at')->nullable()->after('payment_marked_at');
            $table->timestampTz('customer_marked_paid_at')->nullable()->after('provider_marked_paid_at');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn(['provider_marked_paid_at', 'customer_marked_paid_at']);
        });
    }
};
