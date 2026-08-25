<?php

return [
    // Platform default. ESCROW now that Lipila provides compliant custody — new
    // bookings are created ESCROW and traverse the (active) escrow state machine.
    // payment_mode is immutable per booking, so in-flight DIRECT bookings finish
    // under DIRECT rules regardless of this default.
    'payment_mode'          => env('PAYMENT_MODE', 'ESCROW'),
    'response_window_hours' => (int) env('BOOKING_RESPONSE_WINDOW_HOURS', 24),
    'autoconfirm_hours'     => (int) env('BOOKING_AUTOCONFIRM_HOURS', 24),

    // Hours after scheduled_end before a never-started FUNDS_HELD booking is
    // treated as a provider no-show: auto-cancel + full refund (NoShowExpiryWorker).
    'no_show_grace_hours'   => (int) env('BOOKING_NO_SHOW_GRACE_HOURS', 6),

    // QUOTE_DEPOSIT — deposit taken at confirm when a service sets no explicit
    // deposit_percent (§ CFG-6).
    'quote_deposit_default_percent' => (int) env('QUOTE_DEPOSIT_DEFAULT_PCT', 30),

    // HOURLY_CAPPED — observed timer settlement. The charge is derived SERVER-SIDE
    // from the provider's start/finish timestamps (never a self-reported number).
    'hourly' => [
        // Elapsed observed time is rounded UP to this increment before billing.
        'rounding_increment_mins' => (int) env('BOOKING_HOURLY_ROUNDING_MINS', 30),
        // When observed time reaches this fraction of the cap, both parties get
        // the cap-approach prompt (approve an extension, or the job wraps at cap).
        'cap_warn_ratio'          => (float) env('BOOKING_HOURLY_CAP_WARN_RATIO', 0.8),
    ],
];
