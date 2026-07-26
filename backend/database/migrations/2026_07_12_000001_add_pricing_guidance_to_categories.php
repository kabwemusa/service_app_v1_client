<?php

use App\Support\CategoryPricingDefaults;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Category-driven pricing-model guidance (selection guidance + labelling only —
 * the pricing engine + enum are untouched). Adds the admin-editable fields and
 * backfills the seed defaults by slug for the known taxonomy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            // The model a new service here is pre-selected to (null → config default).
            $table->string('default_pricing_model')->nullable()->after('commission_rates');
            // Set that does NOT trigger the mismatch nudge.
            $table->jsonb('recommended_pricing_models')->nullable()->after('default_pricing_model');
            // "Why this pays you fairly" line (null → the model's config rationale).
            $table->text('pricing_rationale')->nullable()->after('recommended_pricing_models');
            // Benefit-framed nudge when an ill-suited model is chosen
            // (null → config('pricing.default_mismatch_warning')).
            $table->text('pricing_mismatch_warning')->nullable()->after('pricing_rationale');
        });

        foreach (CategoryPricingDefaults::map() as $slug => $g) {
            DB::table('categories')->where('slug', $slug)->update([
                'default_pricing_model'      => $g['default'],
                'recommended_pricing_models' => json_encode($g['recommended']),
                'pricing_mismatch_warning'   => $g['warning'],
            ]);
        }
    }

    public function down(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->dropColumn([
                'default_pricing_model',
                'recommended_pricing_models',
                'pricing_rationale',
                'pricing_mismatch_warning',
            ]);
        });
    }
};
