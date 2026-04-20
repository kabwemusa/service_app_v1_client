<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Escrow / Payment configuration
    |--------------------------------------------------------------------------
    */

    // Platform fee percentage charged on every transaction (e.g. 0.05 = 5 %)
    'platform_fee_pct' => (float) env('PLATFORM_FEE_PCT', 0.05),

    // Minutes after booking creation before PENDING_PAYMENT is auto-cancelled
    'ttl_mins'         => (int) env('PAYMENT_TTL_MINS', 60),

    // Hours after DELIVERED before auto-completing (releasing funds) if no dispute
    'dispute_window_hours' => (int) env('DISPUTE_WINDOW_HOURS', 48),

    // Hours admin has to resolve a DISPUTED booking before SLA alert fires
    'dispute_sla_hours' => (int) env('DISPUTE_SLA_HOURS', 72),

    // Payout retry delays in minutes (indexed by retry_count 1, 2, 3)
    'retry_delays' => [
        1 => (int) env('PAYOUT_RETRY_1_MINS', 5),
        2 => (int) env('PAYOUT_RETRY_2_MINS', 30),
        3 => (int) env('PAYOUT_RETRY_3_MINS', 120),
    ],

    'max_retries' => (int) env('PAYOUT_MAX_RETRIES', 3),

    /*
    |--------------------------------------------------------------------------
    | MoMo Gateway (simulated in dev; swap for real credentials in production)
    |--------------------------------------------------------------------------
    */
    'momo' => [
        'base_url'     => env('MOMO_BASE_URL', 'https://sandbox.momodeveloper.mtn.com'),
        'api_key'      => env('MOMO_API_KEY', ''),
        'subscription_key' => env('MOMO_SUBSCRIPTION_KEY', ''),
        'environment'  => env('MOMO_ENVIRONMENT', 'sandbox'),
    ],
];
