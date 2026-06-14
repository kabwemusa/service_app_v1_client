<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * v3.2 §1.6 — per-category proximity decay constant d₀ for the ranking term
 * d = e^(−d_km / d₀). Hyper-local categories (beauty, errands, tutoring) decay
 * fast; thin-supply trades where customers expect travel (plumbing,
 * electrical, professional services) decay slowly.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->decimal('proximity_d0_km', 4, 1)->default(4.0);
        });

        // Seed per the v3.2 remediation plan; unlisted categories keep 4.0.
        $seeds = [
            3.0  => ['Hair & Beauty', 'Tutoring', 'Delivery'],
            4.0  => ['Cleaning', 'Laundry', 'Gardening'],
            8.0  => ['Plumbing', 'Electrical', 'Tech Support'],
            10.0 => ['Photography', 'Graphic Design', 'Catering', 'Transport', 'Security'],
        ];

        foreach ($seeds as $d0 => $names) {
            DB::table('categories')->whereIn('name', $names)->update(['proximity_d0_km' => $d0]);
        }
    }

    public function down(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->dropColumn('proximity_d0_km');
        });
    }
};
