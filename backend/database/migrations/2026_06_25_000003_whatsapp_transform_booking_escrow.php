<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            // Escrow split fields — track the gateway hold and the commission/provider split
            $table->string('escrow_hold_ref', 128)->nullable()->after('payment_mode')
                ->comment('Gateway hold/transaction reference (PawaPay/Flutterwave)');
            $table->decimal('commission_split_zmw', 10, 2)->nullable()->after('buyer_protection_fee')
                ->comment('Platform commission portion held in escrow');
            $table->decimal('provider_split_zmw', 10, 2)->nullable()->after('commission_split_zmw')
                ->comment('Provider portion to be disbursed on completion');

            // Legacy marker for migrated DIRECT bookings
            $table->string('legacy_payment_mode', 10)->nullable()->after('escrow_hold_ref')
                ->comment('Set to DIRECT for migrated bookings; null for new escrow bookings');

            // Channel tracking — which surface originated this booking
            $table->string('channel', 20)->default('APP')->after('legacy_payment_mode')
                ->comment('APP, WHATSAPP, PWA — originating channel');

            // Provider-side quote fields for the QUOTED state
            $table->decimal('quoted_amount', 10, 2)->nullable()->after('agreed_amount')
                ->comment('Provider-proposed price (QUOTED state)');
            $table->text('quote_message')->nullable()->after('quoted_amount')
                ->comment('Provider note accompanying the quote');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn([
                'escrow_hold_ref',
                'commission_split_zmw',
                'provider_split_zmw',
                'legacy_payment_mode',
                'channel',
                'quoted_amount',
                'quote_message',
            ]);
        });
    }
};
