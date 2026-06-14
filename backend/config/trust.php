<?php

/*
|--------------------------------------------------------------------------
| Trust engine corrections (v3.2 §4)
|--------------------------------------------------------------------------
*/

return [

    /*
    | §4.2 — rating recency decay. Each review's weight = 0.5^(age_days / half_life).
    | The decayed mean (users.r_decayed) feeds R_bayes and ranking; the all-time
    | average (users.r_raw) stays on the public profile for transparency.
    */
    'rating_half_life_days' => (int) env('RATING_HALF_LIFE_DAYS', 180),

    /*
    | §4.3 — MoMo wallet name match at Tier 2. Zambian MNOs perform NRC-backed
    | KYC for wallet registration, so a name match between the verified ID and
    | the registered wallet is a second, independent, government-ID-anchored
    | identity confirmation. Mismatch → MANUAL_REVIEW, never auto-reject.
    */
    'momo_name_match' => [
        'enabled'              => (bool) env('KYC_MOMO_NAME_MATCH', true),
        'max_levenshtein'      => (int)  env('KYC_MOMO_NAME_MAX_LEVENSHTEIN', 2),
    ],

    /*
    | §4.4 — message screening. Keyword lists live in the nlp_keywords table
    | (moderator-curated via the admin panel — never hard-coded); this is the
    | cache TTL for the loaded lists.
    */
    'nlp_keyword_cache_seconds' => (int) env('NLP_KEYWORD_CACHE_SECONDS', 600),

];
