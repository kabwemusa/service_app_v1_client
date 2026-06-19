<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->text('notes')->nullable()->after('delivery_location_source');
            $table->jsonb('selected_addon_ids')->nullable()->after('notes');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn(['notes', 'selected_addon_ids']);
        });
    }
};
