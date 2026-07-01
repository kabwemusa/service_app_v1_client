<?php

return [
    // Platform default. ESCROW now that PawaPay provides compliant custody — new
    // bookings are created ESCROW and traverse the (active) escrow state machine.
    // payment_mode is immutable per booking, so in-flight DIRECT bookings finish
    // under DIRECT rules regardless of this default.
    'payment_mode'          => env('PAYMENT_MODE', 'ESCROW'),
    'response_window_hours' => (int) env('BOOKING_RESPONSE_WINDOW_HOURS', 24),
    'autoconfirm_hours'     => (int) env('BOOKING_AUTOCONFIRM_HOURS', 24),
];
