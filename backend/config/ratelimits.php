<?php

/*
|--------------------------------------------------------------------------
| API rate limits (per minute)
|--------------------------------------------------------------------------
| § CFG — read from config (cached) instead of env() inside the RateLimiter
| closures, which run at request time and would ignore .env under config:cache.
| Consumed by AppServiceProvider::configureRateLimiters().
*/

return [
    'auth'    => (int) env('RATE_AUTH_PER_MIN', 5),
    'otp'     => (int) env('RATE_OTP_PER_MIN', 5),
    'match'   => (int) env('RATE_MATCH_PER_MIN', 20),
    'search'  => (int) env('RATE_SEARCH_PER_MIN', 60),
    'write'   => (int) env('RATE_WRITE_PER_MIN', 60),
    'webhook' => (int) env('RATE_WEBHOOK_PER_MIN', 300),
];
