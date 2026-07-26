<?php

/**
 * Growth & Promotions configuration.
 *
 * Everything the campaign engine treats as an enum, default, or threshold lives
 * here so nothing is hardcoded in the admin panel, the RN app, or the PWA. The
 * campaign ROWS carry the audience/offer/placement/budget for a given campaign;
 * this file only defines the vocabulary those rows are chosen from and the
 * platform defaults (e.g. how many inactive days count as "lapsed").
 */
return [

    // Days since a customer's last booking before they count as LAPSED. A
    // campaign may override this per-campaign via audience_params.lapsed_days.
    'lapsed_days_default' => 60,

    // Days-window a provider counts as NEW / LOW_ACTIVITY (provider audiences).
    'new_provider_days'      => 30,
    'low_activity_days'      => 30,
    'low_activity_max_jobs'  => 2,

    // ── Vocabulary (the composer + API validate against these) ───────────────
    'audience_types' => ['CUSTOMER', 'PROVIDER'],

    'audience_filters' => [
        'CUSTOMER' => ['NEW_CUSTOMERS', 'ALL_CUSTOMERS', 'LAPSED', 'BY_AREA', 'BY_CATEGORY'],
        'PROVIDER' => ['NEW_PROVIDERS', 'LOW_ACTIVITY', 'BY_AREA', 'BY_CATEGORY'],
    ],

    'offer_types' => [
        'CUSTOMER' => ['PERCENT_OFF', 'AMOUNT_OFF', 'FREE_SERVICE_FEE'],
        'PROVIDER' => ['ZERO_COMMISSION', 'REDUCED_COMMISSION', 'BONUS'],
    ],

    // APP_* are implemented this phase. PWA_* / WHATSAPP_* are modelled so the
    // slot system extends to them later; the composer shows them disabled.
    'placements' => [
        'implemented' => ['APP_HOME_BANNER', 'APP_SEARCH_BADGE', 'APP_CHECKOUT'],
        'coming_soon' => ['PWA_HOME_BANNER', 'PWA_SEARCH_BADGE', 'PWA_CHECKOUT', 'WHATSAPP_BROADCAST'],
    ],

    'statuses' => ['DRAFT', 'SCHEDULED', 'LIVE', 'PAUSED', 'ENDED', 'BUDGET_EXHAUSTED'],

    // Short-TTL cache for placement evaluation (seconds). Real-time campaign
    // changes bump a version key, so this only bounds staleness on the quiet path.
    'placement_cache_ttl' => 30,

    // Window for the "redemptions (30d)" KPI and default performance range.
    'kpi_window_days' => 30,
];
