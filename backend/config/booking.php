<?php

return [
    'payment_mode'          => env('PAYMENT_MODE', 'DIRECT'),
    'response_window_hours' => (int) env('BOOKING_RESPONSE_WINDOW_HOURS', 24),
    'autoconfirm_hours'     => (int) env('BOOKING_AUTOCONFIRM_HOURS', 24),
];
