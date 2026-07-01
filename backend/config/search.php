<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Typesense Connection
    |--------------------------------------------------------------------------
    */
    'typesense' => [
        'host'                       => env('TYPESENSE_HOST', 'localhost'),
        'port'                       => (int) env('TYPESENSE_PORT', 8108),
        'protocol'                   => env('TYPESENSE_PROTOCOL', 'http'),
        'api_key'                    => env('TYPESENSE_API_KEY', ''),
        'connection_timeout_seconds' => (int) env('TYPESENSE_CONNECTION_TIMEOUT_SECONDS', 2),
        'collection'                 => 'services',
    ],

    /*
    |--------------------------------------------------------------------------
    | Ranking parameters moved to config/ranking.php (v3.2 §1.3)
    |--------------------------------------------------------------------------
    | The v3 §7.2 formula (unnormalized scales, additive cold-start/promoted
    | boosts) was retired per the v3.2 review. See config/ranking.php.
    */

    /*
    |--------------------------------------------------------------------------
    | Search Parameters
    |--------------------------------------------------------------------------
    */
    'search' => [
        'max_results'              => (int) env('MAX_SEARCH_RESULTS',   30),
        'min_profile_completeness' => 40,
        'ranking_candidate_limit'  => 150,
    ],

    /*
    |--------------------------------------------------------------------------
    | Geo-widening (replaces the radius filter)
    |--------------------------------------------------------------------------
    | Candidacy is no longer a distance radius. Search widens the delivery
    | location's region tiers — ward (area) → city (town) → province → national
    | — stopping at the first tier that yields at least `widen_target` results,
    | and only reports "no one" once national is exhausted. Distance remains a
    | soft ranking signal (§1.6), never a hard cut-off.
    |
    | auto_resolve_regions: resolve a provider/service's region from its
    | coordinates on save (via the geocoder). Disabled in the test env for
    | hermeticity — tests seed region columns directly.
    */
    'geo' => [
        'widen_target'         => (int) env('SEARCH_WIDEN_TARGET', 8),
        'auto_resolve_regions' => (bool) env('SEARCH_AUTO_RESOLVE_REGIONS', true),
    ],

    /*
    |--------------------------------------------------------------------------
    | Post-a-request (v3.2 §6 — reverse flow)
    |--------------------------------------------------------------------------
    | Serves urgency ("geyser is leaking NOW") and thin categories. The same
    | candidate pipeline as search picks the top-N providers to notify; the
    | response deadline powers the Quick Responder economy and feeds
    | response_rate_7d.
    */
    'service_requests' => [
        'notify_top_n'           => (int) env('REQUEST_NOTIFY_TOP_N', 10),
        'response_deadline_mins' => (int) env('REQUEST_RESPONSE_DEADLINE_MINS', 30),
        'max_open_per_buyer'     => (int) env('REQUEST_MAX_OPEN_PER_BUYER', 3),
    ],

];
