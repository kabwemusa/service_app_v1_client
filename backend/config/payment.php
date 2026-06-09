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
    | MTN MoMo Gateway
    |--------------------------------------------------------------------------
    |
    | Collections  → RequestToPay  (PAY_IN  — charge the customer)
    | Disbursements→ Transfer      (PAY_OUT — pay the provider; REFUND — return to buyer)
    |
    | Each product needs its own triple: subscription_key + api_user_id + api_key.
    | Get them from the MTN MoMo Developer Portal (momodeveloper.mtn.com).
    |
    | currency         : ZMW for Zambia.
    | poll_max_attempts: how many times to poll for SUCCESSFUL / FAILED.
    | poll_interval_ms : milliseconds to wait between each poll.
    |   Default 24 × 5000 ms = 2 minutes total max wait per transaction.
    |
    | To add Airtel Money or Zamtel later, add a sibling class in
    | App\Services\Payment\ and route in PaymentService::disburse().
    |
    */
    'momo' => [
        'base_url'          => env('MOMO_BASE_URL',     'https://sandbox.momodeveloper.mtn.com'),
        'environment'       => env('MOMO_ENVIRONMENT',  'sandbox'),
        'currency'          => env('MOMO_CURRENCY',     'ZMW'),
        'poll_max_attempts' => (int) env('MOMO_POLL_MAX_ATTEMPTS', 24),
        'poll_interval_ms'  => (int) env('MOMO_POLL_INTERVAL_MS',  5000),

        // Collections — used for PAY_IN (RequestToPay)
        'collections' => [
            'subscription_key' => env('MOMO_COLLECTIONS_SUBSCRIPTION_KEY', ''),
            'api_user_id'      => env('MOMO_COLLECTIONS_API_USER_ID',      ''),
            'api_key'          => env('MOMO_COLLECTIONS_API_KEY',          ''),
        ],

        // Disbursements — used for PAY_OUT and REFUND (Transfer)
        'disbursements' => [
            'subscription_key' => env('MOMO_DISBURSEMENTS_SUBSCRIPTION_KEY', ''),
            'api_user_id'      => env('MOMO_DISBURSEMENTS_API_USER_ID',      ''),
            'api_key'          => env('MOMO_DISBURSEMENTS_API_KEY',          ''),
        ],
    ],
];
