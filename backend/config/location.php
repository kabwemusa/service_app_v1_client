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

];
