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
        // Master driver switch / feature flag. Leave empty to keep the existing
        // nominatim+google behaviour untouched. Set to 'photon' to make the
        // self-hosted Photon instance the forward primary (Google as the
        // cost-bounding fallback) and the reverse primary — no code change.
        'driver' => env('GEOCODER_DRIVER', ''),

        'forward' => env('GEOCODER_FORWARD', 'nominatim'),
        'reverse' => env('GEOCODER_REVERSE', 'nominatim'),

        // Ordered forward fallback chain, tried AFTER the gazetteer; the first
        // driver that returns results wins (the photon → google waterfall).
        // When empty it is derived from `driver`: photon ⇒ ['photon','google'],
        // otherwise ⇒ [forward]. Comma-separated, e.g. "photon,google".
        'forward_chain' => array_values(array_filter(array_map(
            'trim',
            explode(',', (string) env('GEOCODER_FORWARD_CHAIN', '')),
        ))),

        'google' => [
            'key' => env('GOOGLE_PLACES_API_KEY', ''),
        ],
        'nominatim' => [
            'base_url' => env('NOMINATIM_BASE_URL', 'https://nominatim.openstreetmap.org'),
        ],

        // Self-hosted Photon (v3.2 §3.1) — every request constrained & biased
        // to Zambia. The instance is an external HTTP dependency; its data is
        // provisioned out-of-band per PHOTON_GEOCODING_RUNBOOK.md.
        'photon' => [
            'base_url' => env('PHOTON_BASE_URL', 'http://localhost:2322'),

            // Hard country restriction — minLon,minLat,maxLon,maxLat (Zambia).
            'bbox' => env('PHOTON_BBOX', '21.99,-18.08,33.71,-8.22'),
            'lang' => env('PHOTON_LANG', 'en'),
            'limit' => (int) env('PHOTON_LIMIT', 5),
            'timeout' => (int) env('PHOTON_TIMEOUT', 5),

            // Forward proximity bias. When the caller supplies device coords we
            // bias to them; otherwise to this centre (default Lusaka CBD).
            'bias_scale' => (float) env('PHOTON_BIAS_SCALE', 0.7),
            'zoom' => env('PHOTON_ZOOM', null) !== null ? (int) env('PHOTON_ZOOM') : null,
            'fallback_lat' => (float) env('PHOTON_FALLBACK_LAT', -15.4167),
            'fallback_lon' => (float) env('PHOTON_FALLBACK_LON', 28.2833),

            // Granularities surfaced as labels. NB: Photon files landmark POIs
            // (malls, markets, stadiums, hospitals) under the `house` layer —
            // and landmark search is the primary addressing mode in Zambia — so
            // `house` is INCLUDED here despite the "drop house noise" guidance;
            // OSM Zambia carries almost no residential house numbers to filter.
            // Drop `house` only if a deployment genuinely wants admin/street only.
            'layers' => array_values(array_filter(array_map(
                'trim',
                explode(',', (string) env('PHOTON_LAYERS', 'city,locality,district,street,house')),
            ))),

            // Reverse search radius (km) so thin-coverage lookups don't snap to
            // a distant feature.
            'reverse_radius_km' => (float) env('PHOTON_REVERSE_RADIUS_KM', 3),
        ],

        // geo:{geohash6} reverse cache (≈1.2 km × 0.6 km cells)
        'reverse_cache_ttl_days' => (int) env('GEOCODE_REVERSE_CACHE_TTL_DAYS', 30),

        // Gazetteer entries need this many confirmations before they rank
        // above external autocomplete results.
        'gazetteer_min_confirms' => (int) env('GAZETTEER_MIN_CONFIRMS', 3),

        // Forward: when the gazetteer returns a confident match, return it
        // directly without calling any external driver. Off by default to
        // preserve the existing gazetteer-above-external blend.
        'gazetteer_short_circuit' => (bool) env('GAZETTEER_SHORT_CIRCUIT', false),

        // Forward: let a gazetteer entry normalise the query before downstream
        // lookup (e.g. append ", Lusaka"). Off by default — it changes behaviour.
        'gazetteer_query_rewrite' => (bool) env('GAZETTEER_QUERY_REWRITE', false),

        // Reverse: snap the resolved region/ward to the gazetteer's canonical
        // value for the cell, keeping internal regions consistent with the
        // matching pipeline's geo rings rather than trusting raw OSM admin names.
        'reverse_snap' => (bool) env('GEOCODE_REVERSE_SNAP', true),
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
