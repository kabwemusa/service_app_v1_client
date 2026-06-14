<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * v3.2 §5 — the repeat-pair taper appears as its own line in the provider's
 * itemized statement ("Repeat-client discount"); the no-hidden-fees principle
 * cuts both ways.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commissions', function (Blueprint $table) {
            $table->decimal('repeat_discount_rate', 4, 3)->default(0)->after('commission_rate');
            $table->unsignedInteger('pair_booking_number')->nullable()->after('repeat_discount_rate');
        });
    }

    public function down(): void
    {
        Schema::table('commissions', function (Blueprint $table) {
            $table->dropColumn(['repeat_discount_rate', 'pair_booking_number']);
        });
    }
};
