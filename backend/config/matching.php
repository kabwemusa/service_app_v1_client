<?php

/**
 * Natural-language service matcher — layered pipeline config.
 *
 * The matcher finds WHAT the customer needs (real catalog categories/services);
 * the existing ranking engine (config/ranking.php + SearchService) decides WHO.
 * Every threshold here is tunable WITHOUT a deploy so precision/recall can be
 * calibrated from real usage (see match_query_logs). Synonyms are NOT here —
 * they live per-category in `categories.synonyms`, admin-editable.
 */
return [

    // Master switch. When false the surfaces fall back to plain keyword search.
    'enabled' => (bool) env('MATCHING_ENABLED', true),

    /*
    |--------------------------------------------------------------------------
    | Confidence gate — show vs ask vs honest-empty
    |--------------------------------------------------------------------------
    | Cosine similarity is in [0,1]. Above `show` we return matched services.
    | Between `clarify` and `show` (or when the top two are a near tie) we ask
    | with 2–3 real candidates instead of guessing. Below `clarify` we return
    | the honest empty state (closest categories + browse-all).
    */
    'thresholds' => [
        'show'        => (float) env('MATCHING_SHOW_THRESHOLD', 0.62),
        'clarify'     => (float) env('MATCHING_CLARIFY_THRESHOLD', 0.40),
        // If (top1 - top2) is under this, results are "tied" → ambiguous → ask/LLM.
        'tie_margin'  => (float) env('MATCHING_TIE_MARGIN', 0.05),
        // Layer 1 fuzzy (trigram/levenshtein) acceptance for typo tolerance.
        'fuzzy'       => (float) env('MATCHING_FUZZY_THRESHOLD', 0.55),
    ],

    // How many nearest candidates the semantic layer retrieves / hands to the LLM.
    'top_k'            => (int) env('MATCHING_TOP_K', 5),
    // How many candidates a clarify response offers the customer.
    'clarify_options' => (int) env('MATCHING_CLARIFY_OPTIONS', 3),

    /*
    |--------------------------------------------------------------------------
    | Layer toggles (cost control / progressive rollout)
    |--------------------------------------------------------------------------
    */
    'layers' => [
        'semantic' => (bool) env('MATCHING_SEMANTIC_ENABLED', true),
        'llm'      => (bool) env('MATCHING_LLM_ENABLED', true),
    ],

    /*
    |--------------------------------------------------------------------------
    | Embeddings (Layer 2)
    |--------------------------------------------------------------------------
    | driver: 'openai'  — OpenAI-compatible embeddings HTTP endpoint (also works
    |                     with any compatible gateway via base_url).
    |         'hash'    — deterministic local pseudo-embedding (no API key). The
    |                     default so the pipeline is fully testable offline; swap
    |                     to 'openai' in production for true semantic matching.
    | Embeddings are cached; the whole index is small enough to hold in memory.
    */
    'embeddings' => [
        'driver'     => env('MATCHING_EMBEDDING_DRIVER', 'hash'),
        'cache_ttl'  => (int) env('MATCHING_EMBEDDING_CACHE_TTL', 600), // seconds

        'openai' => [
            'base_url'    => env('MATCHING_EMBEDDING_BASE_URL', 'https://api.openai.com/v1'),
            'api_key'     => env('MATCHING_EMBEDDING_API_KEY', env('OPENAI_API_KEY', '')),
            'model'       => env('MATCHING_EMBEDDING_MODEL', 'text-embedding-3-small'),
            'dimensions'  => (int) env('MATCHING_EMBEDDING_DIMENSIONS', 1536),
            'timeout'     => (int) env('MATCHING_EMBEDDING_TIMEOUT', 15),
        ],

        'hash' => [
            'dimensions' => (int) env('MATCHING_HASH_DIMENSIONS', 256),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | LLM disambiguation (Layer 3) — SELECT from real candidates only
    |--------------------------------------------------------------------------
    | driver: 'anthropic' — Claude Haiku via the Messages API, forced tool-use
    |                       constrained to candidate IDs (a cheap selection task,
    |                       so a small model is correct here — not a large one).
    |         'null'      — keyless fallback: picks the top candidate when it
    |                       clears `clarify`, else "none". Used in tests/dev.
    | The LLM NEVER invents a service — its output is validated against the
    | candidate ID set and anything else is discarded.
    */
    'llm' => [
        'driver' => env('MATCHING_LLM_DRIVER', 'null'),

        'anthropic' => [
            'base_url'   => env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
            'api_key'    => env('ANTHROPIC_API_KEY', ''),
            'model'      => env('MATCHING_LLM_MODEL', 'claude-haiku-4-5'),
            'version'    => env('ANTHROPIC_VERSION', '2023-06-01'),
            'max_tokens' => (int) env('MATCHING_LLM_MAX_TOKENS', 256),
            'timeout'    => (int) env('MATCHING_LLM_TIMEOUT', 12),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Result caching — frequent-query cache (cost control)
    |--------------------------------------------------------------------------
    */
    'result_cache_ttl' => (int) env('MATCHING_RESULT_CACHE_TTL', 300), // seconds; 0 = off

    // Query normalisation caps.
    'max_query_length' => (int) env('MATCHING_MAX_QUERY_LENGTH', 160),
];
