<?php

return [
    // Platform default. ESCROW now that PawaPay provides compliant custody — new
    // bookings are created ESCROW and traverse the (active) escrow state machine.
    // payment_mode is immutable per booking, so in-flight DIRECT bookings finish
    // under DIRECT rules regardless of this default.
    'payment_mode'          => env('PAYMENT_MODE', 'ESCROW'),
    'response_window_hours' => (int) env('BOOKING_RESPONSE_WINDOW_HOURS', 24),
    'autoconfirm_hours'     => (int) env('BOOKING_AUTOCONFIRM_HOURS', 24),

    // Hours after scheduled_end before a never-started FUNDS_HELD booking is
    // treated as a provider no-show: auto-cancel + full refund (NoShowExpiryWorker).
    'no_show_grace_hours'   => (int) env('BOOKING_NO_SHOW_GRACE_HOURS', 6),
];
