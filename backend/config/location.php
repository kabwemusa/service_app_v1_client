<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Saved locations (v3.1 §4.2, §10.2)
    |--------------------------------------------------------------------------
    | Cap per user — open product decision §10.2 suggested 5 (ride-hailing-style
    | address book: Home, Work, a couple of others).
    */
    'saved_location_limit' => (int) env('SAVED_LOCATION_LIMIT', 5),

    /*
    |--------------------------------------------------------------------------
    | Geocoding (v3.2 §3.1 — hybrid, driver per operation)
    |--------------------------------------------------------------------------
    | forward: 'google' (Places autocomplete, session tokens — best Lusaka
    | POI/landmark coverage) or 'nominatim' (keyless fallback).
    | reverse: 'nominatim' (high volume, neighborhood labels, zero cost).
    */
    'geocoding' => [
        'forward' => env('GEOCODER_FORWARD', 'nominatim'),
        'reverse' => env('GEOCODER_REVERSE', 'nominatim'),

        'google' => [
            'key' => env('GOOGLE_PLACES_API_KEY', ''),
        ],
        'nominatim' => [
            'base_url' => env('NOMINATIM_BASE_URL', 'https://nominatim.openstreetmap.org'),
        ],

        // geo:{geohash6} reverse cache (≈1.2 km × 0.6 km cells)
        'reverse_cache_ttl_days' => (int) env('GEOCODE_REVERSE_CACHE_TTL_DAYS', 30),

        // Gazetteer entries need this many confirmations before they rank
        // above external autocomplete results.
        'gazetteer_min_confirms' => (int) env('GAZETTEER_MIN_CONFIRMS', 3),
    ],

    /*
    |--------------------------------------------------------------------------
    | Transit feasibility (v3.2 §1.6 — scheduling, not ranking)
    |--------------------------------------------------------------------------
    | Straight-line distance is fine for ranking, but for the v2 §4.2 conflict
    | checker apply a road-circuity factor and congestion-aware speeds:
    | 20 km/h during Lusaka peak (06:30–09:00, 16:30–19:00), 30 km/h otherwise.
    */
    'transit' => [
        'circuity'          => (float) env('TRANSIT_CIRCUITY', 1.35),
        'speed_peak_kmh'    => (float) env('TRANSIT_SPEED_PEAK_KMH', 20),
        'speed_offpeak_kmh' => (float) env('TRANSIT_SPEED_OFFPEAK_KMH', 30),
        'buffer_mins'       => (float) env('TRANSIT_BUFFER_MINS', 15),
        'peak_windows'      => [['06:30', '09:00'], ['16:30', '19:00']],
    ],

];
