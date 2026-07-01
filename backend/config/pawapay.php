<?php

return [

    'enabled' => env('PAWAPAY_ENABLED', false),

    'base_url' => env('PAWAPAY_BASE_URL', 'https://api.sandbox.pawapay.io'),

    'api_token' => env('PAWAPAY_API_TOKEN'),

    'currency' => env('PAWAPAY_CURRENCY', 'ZMW'),

    'country' => env('PAWAPAY_COUNTRY', 'ZMB'),

    // Zambia MNO correspondent codes
    'correspondents' => [
        'AIRTEL' => 'AIRTEL_OAPI_ZMB',
        'MTN'    => 'MTN_MOMO_ZMB',
        'ZAMTEL' => 'ZAMTEL_ZMB',
    ],

    // Phone prefix → correspondent mapping (after stripping +260)
    'prefix_map' => [
        '097' => 'AIRTEL_OAPI_ZMB',
        '077' => 'AIRTEL_OAPI_ZMB',
        '096' => 'MTN_MOMO_ZMB',
        '076' => 'MTN_MOMO_ZMB',
        '095' => 'ZAMTEL_ZMB',
        '075' => 'ZAMTEL_ZMB',
    ],

    'statement_description' => env('PAWAPAY_STATEMENT', 'Sebenza'),

    // SANDBOX TESTING ONLY. When set (and base_url points at sandbox), every deposit's
    // payer MSISDN is replaced with this pawaPay test number so the outcome is
    // deterministic. Leave UNSET in production.
    //   260973456789 → COMPLETED   260973456049 → INSUFFICIENT_BALANCE
    //   260973456019 → PAYER_LIMIT_REACHED   260973456069 → UNSPECIFIED_FAILURE
    'sandbox_force_payer' => env('PAWAPAY_SANDBOX_FORCE_PAYER'),

    // Timeout for pending deposits before marking as failed (minutes)
    'deposit_timeout_minutes' => env('PAWAPAY_DEPOSIT_TIMEOUT', 15),
];
