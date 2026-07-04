<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            // Gateway payout reference (PawaPay payoutId), captured when
            // BookingService::disbursePayout initiates the transfer. Lets the
            // payout callback (PawapayCallbackController::handlePayoutCallback)
            // look up the booking directly — the same reliable pattern already
            // used for deposits via escrow_hold_ref — instead of depending on
            // metadata echoed back by pawaPay, which is not consistently shaped.
            $table->string('payout_ref', 128)->nullable()->after('escrow_hold_ref')
                ->comment('Gateway payout/transfer reference (PawaPay), set on disbursement');
            $table->index('payout_ref');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn('payout_ref');
        });
    }
};
