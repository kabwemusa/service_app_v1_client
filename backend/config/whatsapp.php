<?php

return [
    'access_token'        => env('WHATSAPP_ACCESS_TOKEN'),
    'phone_number_id'     => env('WHATSAPP_PHONE_NUMBER_ID'),
    'business_account_id' => env('WHATSAPP_BUSINESS_ACCOUNT_ID'),
    'app_secret'          => env('WHATSAPP_APP_SECRET'),
    'verify_token'        => env('WHATSAPP_VERIFY_TOKEN'),
    'graph_api_version'   => env('GRAPH_API_VERSION', 'v21.0'),

    'test_mode' => env('WHATSAPP_TEST_MODE', false),

    'timeouts' => [
        'collecting_nudge_minutes' => 10,
        'collecting_expiry_minutes' => 30,
        'provider_accept_minutes'  => 15,
        'funding_window_minutes'   => 30,
        'auto_complete_hours'      => 24,
    ],

    'template_language' => env('WHATSAPP_TEMPLATE_LANGUAGE', 'en'),
];
