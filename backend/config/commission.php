<?php

/*
|--------------------------------------------------------------------------
| Commission & fee configuration (§8.2)
|--------------------------------------------------------------------------
| § CFG-1/CFG-3 — these were read via env() at runtime inside CommissionService,
| which silently falls back to the hardcoded default under `php artisan
| config:cache` (standard in production), ignoring the real .env override. They
| now live in a config file (env is read here, at cache time) so overrides take
| effect. The admin-editable subset (buyer protection) is additionally read live
| through App\Support\Settings.
*/

return [
    'vat_rate'            => (float) env('PLATFORM_VAT_RATE',      0.16),
    'processor_fee_pct'   => (float) env('MOMO_PROCESSOR_FEE_PCT', 0.015),

    'buyer_protection_rate'    => (float) env('BUYER_PROTECTION_RATE',    0.02),
    'buyer_protection_max_zmw' => (float) env('BUYER_PROTECTION_MAX_ZMW', 50.0),

    // Default per-tier commission rates (fallback when a category has no override).
    'tier_rates' => [
        1 => (float) env('DEFAULT_COMMISSION_TIER1', 0.18),
        2 => (float) env('DEFAULT_COMMISSION_TIER2', 0.15),
        3 => (float) env('DEFAULT_COMMISSION_TIER3', 0.13),
        4 => (float) env('DEFAULT_COMMISSION_TIER4', 0.11),
    ],

    // Subscription plan discounts (points off the tier rate).
    'subscription_discounts' => [
        'PRO'   => (float) env('SUBSCRIPTION_PRO_DISCOUNT',   0.02),
        'ELITE' => (float) env('SUBSCRIPTION_ELITE_DISCOUNT', 0.04),
    ],
];
