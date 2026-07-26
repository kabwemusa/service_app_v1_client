<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Delivery types
    |--------------------------------------------------------------------------
    | How a service is delivered. IN_PERSON is the default (provider travels to
    | the customer / meets at a venue — geo applies). REMOTE means the work is
    | delivered online (tutoring, design, consulting): nationwide, no location
    | capture, and the eligibility/dispatch layer bypasses geo entirely.
    |
    | Every surface (app, PWA, WhatsApp, admin) reads these from here — never an
    | inline literal.
    */
    'delivery_types' => [
        'IN_PERSON' => [
            'value'       => 'IN_PERSON',
            'label'       => 'In person',
            'description' => 'You travel to the customer or meet at a venue.',
            'remote'      => false,
            'default'     => true,
        ],
        'REMOTE' => [
            'value'       => 'REMOTE',
            'label'       => 'Delivered online',
            'description' => 'Done remotely — tutoring, design, consulting. Nationwide, no location needed.',
            'remote'      => true,
            'default'     => false,
        ],
    ],

    // The label shown wherever a remote service would otherwise show an area /
    // distance (cards, shortlist, booking detail, WhatsApp).
    'online_location_label' => 'Online',

    /*
    |--------------------------------------------------------------------------
    | Category picker
    |--------------------------------------------------------------------------
    | How many "popular" categories the searchable picker shows as quick-tap
    | chips before the user searches the full taxonomy.
    */
    'popular_category_limit' => (int) env('CATALOG_POPULAR_CATEGORY_LIMIT', 8),
];
