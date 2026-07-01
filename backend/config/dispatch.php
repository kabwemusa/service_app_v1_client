<?php

return [
    'shortlist_size' => (int) env('DISPATCH_SHORTLIST_SIZE', 3),

    'geo' => [
        'ring1_km' => (float) env('DISPATCH_GEO_RING1_KM', 5),
        'ring2_km' => (float) env('DISPATCH_GEO_RING2_KM', 25),
        'ring3_km' => (float) env('DISPATCH_GEO_RING3_KM', 100),
    ],

    'fairness' => [
        'shortlist_share' => (float) env('DISPATCH_FAIRNESS_SHARE', 0.20),
        'probation_jobs'  => (int) env('DISPATCH_FAIRNESS_PROBATION_JOBS', 10),
    ],

    'accept_window' => [
        'default_minutes'   => (int) env('DISPATCH_ACCEPT_WINDOW_MINS', 15),
        'urgent_minutes'    => (int) env('DISPATCH_ACCEPT_URGENT_MINS', 5),
    ],

    'scoring' => [
        'decay_lambda'        => (float) env('DISPATCH_DECAY_LAMBDA', 0.005),
        'shrink_k'            => (int) env('DISPATCH_SHRINK_K', 5),
        'reliability_prior'   => (float) env('DISPATCH_RELIABILITY_PRIOR', 70),
        'financial_prior'     => (float) env('DISPATCH_FINANCIAL_PRIOR', 80),
        'dispute_prior'       => (float) env('DISPATCH_DISPUTE_PRIOR', 0.05),
        'rating_prior'        => (float) env('DISPATCH_RATING_PRIOR', 3.5),
        'rating_half_life_days' => (int) env('DISPATCH_RATING_HALF_LIFE', 180),

        'weights' => [
            'tier_1' => ['identity' => 0.15, 'reliability' => 0.30, 'financial' => 0.20, 'ratings' => 0.35],
            'tier_2' => ['identity' => 0.25, 'reliability' => 0.25, 'financial' => 0.20, 'ratings' => 0.30],
            'tier_3' => ['identity' => 0.40, 'reliability' => 0.25, 'financial' => 0.20, 'ratings' => 0.15],
            'tier_4' => ['identity' => 0.40, 'reliability' => 0.25, 'financial' => 0.20, 'ratings' => 0.15],
        ],
    ],
];
