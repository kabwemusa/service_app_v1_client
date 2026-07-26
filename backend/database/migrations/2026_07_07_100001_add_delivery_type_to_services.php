<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Remote / online services.
 *
 * services.delivery_type = IN_PERSON | REMOTE.
 *   IN_PERSON — provider travels / meets at a venue; geo applies (default).
 *   REMOTE    — delivered online (tutoring, design, consulting): nationwide,
 *               no location capture, eligibility/dispatch bypasses geo.
 *
 * Existing services default to IN_PERSON (behaviour unchanged). Mirrored onto
 * the provider_services join used by the WhatsApp catalog.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('services', function (Blueprint $table) {
            $table->string('delivery_type', 10)->default('IN_PERSON')->after('description')
                ->comment('IN_PERSON | REMOTE — REMOTE is delivered online and bypasses geo');
        });

        DB::statement("UPDATE services SET delivery_type = 'IN_PERSON' WHERE delivery_type IS NULL");

        DB::statement("ALTER TABLE services ADD CONSTRAINT services_delivery_type_check
            CHECK (delivery_type IN ('IN_PERSON','REMOTE'))");

        // WhatsApp catalog join mirrors it so remote services read "Online" there too.
        if (Schema::hasTable('provider_services')) {
            Schema::table('provider_services', function (Blueprint $table) {
                if (! Schema::hasColumn('provider_services', 'delivery_type')) {
                    $table->string('delivery_type', 10)->default('IN_PERSON')->after('pricing_model');
                }
            });
            DB::statement("UPDATE provider_services SET delivery_type = 'IN_PERSON' WHERE delivery_type IS NULL");
        }
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE services DROP CONSTRAINT IF EXISTS services_delivery_type_check');
        Schema::table('services', function (Blueprint $table) {
            $table->dropColumn('delivery_type');
        });

        if (Schema::hasTable('provider_services') && Schema::hasColumn('provider_services', 'delivery_type')) {
            Schema::table('provider_services', function (Blueprint $table) {
                $table->dropColumn('delivery_type');
            });
        }
    }
};
