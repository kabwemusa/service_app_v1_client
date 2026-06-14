<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commissions', function (Blueprint $table) {
            // Which mode this commission belongs to
            $table->string('payment_mode', 10)->default('ESCROW')->after('calculated_at');

            // DIRECT = shadow-ledger (would-be revenue); ESCROW = actually collected
            $table->string('collection_status', 20)->default('COLLECTED')->after('payment_mode');
        });

        DB::statement("
            ALTER TABLE commissions
            ADD CONSTRAINT commissions_payment_mode_check CHECK (payment_mode IN ('DIRECT','ESCROW'))
        ");

        DB::statement("
            ALTER TABLE commissions
            ADD CONSTRAINT commissions_collection_status_check CHECK (collection_status IN ('COLLECTED','UNCOLLECTED'))
        ");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE commissions DROP CONSTRAINT IF EXISTS commissions_payment_mode_check');
        DB::statement('ALTER TABLE commissions DROP CONSTRAINT IF EXISTS commissions_collection_status_check');

        Schema::table('commissions', function (Blueprint $table) {
            $table->dropColumn(['payment_mode', 'collection_status']);
        });
    }
};
