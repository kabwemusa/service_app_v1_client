<?php

/*
|--------------------------------------------------------------------------
| Cross-Origin Resource Sharing (CORS) Configuration
|--------------------------------------------------------------------------
|
| The admin panel (Next.js) runs on a different origin from this API, so the
| browser sends cross-origin requests. Allow the panel's origin(s) explicitly.
| Set CORS_ALLOWED_ORIGINS in .env (comma-separated) for non-local environments.
|
*/

return [

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => array_filter(array_map(
        'trim',
        explode(',', env('CORS_ALLOWED_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000')),
    )),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    // The panel attaches a Bearer token; credentials are enabled so cookie-based
    // flows also work if needed.
    'supports_credentials' => true,

];
