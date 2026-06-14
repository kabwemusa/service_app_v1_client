<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * v3.1 availability concept — the Hub "Available / Away" toggle.
 * Away stops NEW booking requests; it never affects confirmed bookings.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('provider_profiles', function (Blueprint $table) {
            $table->boolean('accepting_bookings')->default(true)->after('availability_matrix');
        });
    }

    public function down(): void
    {
        Schema::table('provider_profiles', function (Blueprint $table) {
            $table->dropColumn('accepting_bookings');
        });
    }
};
