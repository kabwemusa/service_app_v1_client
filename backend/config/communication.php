<?php

/**
 * Provider ↔ customer communication layer.
 *
 * DELIBERATE product decision: the platform provides NO in-app chat and NO
 * in-app VoIP. Communication is limited to three narrow, privacy-preserving
 * channels, all configured here so nothing is hard-coded:
 *
 *   1. MASKED CALLING — a proxied voice call routed through a telecom provider
 *      so NEITHER party ever sees the other's real number. Gated to funded,
 *      active bookings; disabled again after the dispute window closes. Only
 *      call METADATA is logged (never content).
 *   2. STRUCTURED STATUS UPDATES — tap-to-send preset messages ("On my way",
 *      "Arrived", …). No free-form typing. Each is immutable dispute evidence.
 *   3. FREE-FORM → WHATSAPP — anything beyond the presets deep-links to the
 *      platform's existing WhatsApp channel. We do not build a messenger.
 */
return [

    // ── Masked calling ───────────────────────────────────────────────────────
    'calling' => [
        // Active provider driver. See App\Services\Communication\MaskedCall.
        //   'africastalking' — Africa's Talking Voice (the only Zambia-native
        //                      voice provider verified to cover MTN/Airtel/Zamtel;
        //                      masks via a virtual number that bridges both legs).
        //   'log'            — dev/test: records the intent, places no real call.
        //   'reveal'         — FALLBACK ONLY: time-limited, consented number
        //                      reveal when no masking number can be provisioned.
        //                      This is a documented exception to "numbers never
        //                      exposed"; keep OFF unless masking is unavailable.
        'provider' => env('CALL_MASKING_PROVIDER', 'log'),

        // Africa's Talking Voice credentials + the virtual number that both
        // legs are bridged through (the masked caller-ID both parties see).
        'africastalking' => [
            'username'       => env('AT_USERNAME'),
            'api_key'        => env('AT_API_KEY'),
            'virtual_number' => env('AT_VOICE_NUMBER'),   // e.g. +260xxxxxxxxx
            'base_url'       => env('AT_VOICE_BASE_URL', 'https://voice.africastalking.com'),
        ],

        // How long a bridged masked session stays valid before the provider
        // tears it down (metadata retained regardless).
        'session_ttl_minutes' => (int) env('CALL_SESSION_TTL_MINUTES', 30),

        // Consented-reveal fallback: how long a revealed number stays visible.
        'reveal_ttl_minutes'  => (int) env('CALL_REVEAL_TTL_MINUTES', 60),
    ],

    // ── When may the parties reach each other at all? ────────────────────────
    // Contact opens only once money is custodied (§ anti-circumvention: no
    // contact before the platform is committed) and closes after the dispute
    // window lapses on a completed booking.
    'contact_window' => [
        // Statuses in which masked calling + status updates are available.
        'active_statuses' => ['FUNDS_HELD', 'DEPOSIT_HELD', 'IN_PROGRESS', 'DELIVERED', 'DISPUTED'],
        // After COMPLETED, contact stays open for this many hours (coordinating
        // any post-job issue / dispute), then closes. DISBURSED is always closed.
        'dispute_window_hours' => (int) env('BOOKING_DISPUTE_WINDOW_HOURS', 48),
    ],

    // ── Structured status-update presets (NOT free-form) ─────────────────────
    // The catalogue is config so copy/options can change without code. Each
    // preset declares:
    //   role         — who may send it ('provider' | 'customer')
    //   label        — button text on the client
    //   body         — notification body sent to the OTHER party ({name}, {mins})
    //   time_critical— high-priority push + SMS fallback
    //   requires     — extra payload the client must supply ('duration' | 'note')
    //   drives       — a booking lifecycle action this preset delegates to
    //                  ('start' | 'finish'); ties "Job started/finished" into the
    //                  HOURLY_CAPPED observed timer via BookingService (one impl).
    'status_presets' => [
        'ON_MY_WAY'   => ['role' => 'provider', 'label' => 'On my way',    'body' => 'Your provider is on the way.',                 'time_critical' => true],
        'ARRIVED'     => ['role' => 'provider', 'label' => 'Arrived',       'body' => 'Your provider has arrived.',                   'time_critical' => true],
        'RUNNING_LATE'=> ['role' => 'provider', 'label' => 'Running late',  'body' => 'Your provider is running about {mins} min late.', 'time_critical' => true, 'requires' => 'duration'],
        'JOB_STARTED' => ['role' => 'provider', 'label' => 'Job started',   'body' => 'Your provider has started the job.',           'drives' => 'start'],
        'JOB_FINISHED'=> ['role' => 'provider', 'label' => 'Job finished',  'body' => 'Your provider has marked the job finished.',   'drives' => 'finish'],
        'IM_READY'    => ['role' => 'customer', 'label' => "I'm ready",     'body' => 'The customer is ready for you.',               'time_critical' => true],
        'PLEASE_WAIT' => ['role' => 'customer', 'label' => 'Please wait',   'body' => 'The customer has asked you to wait a moment.', 'time_critical' => true],
        'LOCATION_NOTE'=> ['role' => 'customer','label' => 'Location note', 'body' => 'The customer added a note: {note}',            'requires' => 'note'],
    ],

    // Allowed durations (minutes) for the RUNNING_LATE preset. Config so the
    // choices are not baked into the clients.
    'late_durations' => [10, 15, 30],

    // Max length of the single free-text field that can pass through the
    // platform (the customer's LOCATION_NOTE). This text is screened for
    // off-platform-contact / MoMo-solicitation and flagged best-effort.
    'note_max_length' => (int) env('COMMS_NOTE_MAX_LENGTH', 200),
];
