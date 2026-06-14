<?php

/*
|--------------------------------------------------------------------------
| Ranking Engine — v3.2 §1.3 corrected composite score
|--------------------------------------------------------------------------
| All features are normalized to [0,1] before weighting:
|
|   r    = (R_bayes − 1) / 4
|   c    = completion_rate_shrunk            (§4.1 shrinkage prior)
|   ver  = tier step: T1=0.4 T2=0.7 T3=0.9 T4=1.0
|   resp = 1 / (1 + e^(0.02·(p50_mins − 30)))
|   f    = e^(−0.05 · days_inactive)
|   d    = e^(−d_km / d0)                    (§1.6 exponential proximity)
|   p    = price_fit                         (Phase 3 — constant 0.5 stub)
|
|   S_organic = Σ wᵢ·featureᵢ           (weights sum to 1.0)
|   S         = (S_organic + B_cold + B_personal) × M_tier
|
| Promoted placement is NOT part of this score (v3.2 §1.5) — promoted
| inventory occupies reserved, labeled slots (Phase 1).
*/

return [

    'weights' => [
        'rating'       => (float) env('RANK_W_RATING',       0.25),
        'completion'   => (float) env('RANK_W_COMPLETION',   0.15),
        'verification' => (float) env('RANK_W_VERIFICATION', 0.15),
        'response'     => (float) env('RANK_W_RESPONSE',     0.10),
        'freshness'    => (float) env('RANK_W_FRESHNESS',    0.05),
        'proximity'    => (float) env('RANK_W_PROXIMITY',    0.20),
        'price'        => (float) env('RANK_W_PRICE',        0.10),
    ],

    // B_cold — bounded cold-start visibility boost (replaces v3's +2.0)
    'cold_boost'         => (float) env('RANK_COLD_BOOST', 0.06),
    'cold_job_threshold' => (int)   env('RANK_COLD_JOB_THRESHOLD', 3),

    // M_tier — explicit Tier-1 de-rank multiplier (replaces v3 §4.1's "30%")
    'tier1_multiplier'   => (float) env('RANK_TIER1_MULTIPLIER', 0.85),

    // §1.6 proximity decay half-feel; per-category d₀ arrives in Phase 1
    'proximity_d0_default_km' => (float) env('PROXIMITY_D0_DEFAULT_KM', 4.0),

    // §1.7 price-fit — Phase 3. Until enabled, p = 0.5 constant.
    'price_fit_enabled' => (bool) env('RANK_PRICE_FIT_ENABLED', false),

    // §2 personalization — B_personal components (rules-based, no ML)
    'personal_repeat_boost'   => (float) env('RANK_PERSONAL_REPEAT_BOOST', 0.15),
    'personal_category_boost' => (float) env('RANK_PERSONAL_CATEGORY_BOOST', 0.03),
    'personal_cache_ttl_seconds' => 60 * 60 * 24, // buyer:{id}:* sets, invalidated on completion
    'personal_recent_days'    => 90,

    // §4.1 cold-start shrinkage priors
    'shrink_k'                => (int)   env('SHRINK_K', 5),
    'shrink_completion_prior' => (float) env('SHRINK_COMPLETION_PRIOR', 0.85),
    'shrink_response_prior'   => (float) env('SHRINK_RESPONSE_PRIOR', 0.70),

    // Bayesian rating shrinkage (v3 §7.1, m = 5)
    'min_reviews' => (int) env('RANKING_MIN_REVIEWS', 5),

    // Platform-mean prior: c_mean is itself shrunk toward this neutral value
    // so an unrated (launch-day) platform doesn't collapse every provider's
    // rating term to 0 — which would push Tier-1 newcomers under the 0.40
    // trust floor and empty the search results (§4.1 dead-end).
    'c_mean_prior' => (float) env('RANK_C_MEAN_PRIOR', 4.0),

    // Freshness decay rate (λ in e^(−λ·days_inactive))
    'freshness_lambda' => (float) env('RANKING_INACTIVITY_LAMBDA', 0.05),

    // v3 §7.4 hard-filter floor — gating only, never a ranking term (§1.2)
    'trust_score_floor' => (float) env('TRUST_SEARCH_FLOOR', 0.40),

    // §1.8 deterministic fairness slots — 1-indexed result positions reserved
    // for the highest-scoring eligible providers with < new_provider_jobs
    // completed jobs (organic fills the slot when none qualify).
    'fairness_slots'     => [5, 10, 15, 20],
    'new_provider_jobs'  => (int) env('FAIRNESS_NEW_PROVIDER_JOBS', 10),

    // v3 §7.5 — max consecutive results per provider
    'max_consecutive_per_provider' => 2,

    // Cache TTLs
    'c_mean_ttl_seconds'   => 3600,
    'p50_median_ttl_seconds' => 60 * 60 * 26, // refreshed nightly; 26h covers job drift

];
