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
    | Ranking Engine Parameters  (v3 §7.2)
    |--------------------------------------------------------------------------
    | S = w1·R_bayes + w2·C + w3·T - w4·ln(T_res+1)
    |   + w5·e^(-λ·t_inactive) + w6·D_proximity + N_boost + P_boost
    */
    'ranking' => [
        'w1_bayes'               => (float) env('RANKING_W1_BAYES',         0.28),
        'w2_completion'          => (float) env('RANKING_W2_COMPLETION',     0.20),
        'w3_trust'               => (float) env('RANKING_W3_TRUST',          0.20),
        'w4_response'            => (float) env('RANKING_W4_RESPONSE',       0.10),
        'w5_activity'            => (float) env('RANKING_W5_ACTIVITY',       0.10),
        'w6_proximity'           => (float) env('RANKING_W6_PROXIMITY',      0.12),
        'lambda'                 => (float) env('RANKING_INACTIVITY_LAMBDA', 0.05),
        'min_reviews'            => (int)   env('RANKING_MIN_REVIEWS',       5),
        'cold_start_boost'       => (float) env('COLD_START_BOOST',          2.0),
        'cold_start_threshold'   => (int)   env('COLD_START_JOB_THRESHOLD',  3),
        'promo_boost'            => (float) env('PROMO_BOOST',               1.5),
        'fairness_new_reserve'   => (float) env('FAIRNESS_NEW_PROVIDER_RESERVE', 0.20),
        'trust_score_floor'      => (float) env('TRUST_SEARCH_FLOOR',        0.40),
        'c_mean_ttl_seconds'     => 3600,
        'provider_score_ttl'     => 3600,
    ],

    /*
    |--------------------------------------------------------------------------
    | Search Parameters
    |--------------------------------------------------------------------------
    */
    'search' => [
        'max_radius_km'            => (int) env('MAX_SEARCH_RADIUS_KM', 20),
        'max_results'              => (int) env('MAX_SEARCH_RESULTS',   30),
        'min_profile_completeness' => 40,
        'ranking_candidate_limit'  => 150,
    ],

];
