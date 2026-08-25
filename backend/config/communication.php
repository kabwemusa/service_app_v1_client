<?php

/**
 * Provider ↔ customer communication layer.
 *
 * DELIBERATE product decision: the platform provides NO in-app chat, NO in-app
 * VoIP, and NO masked calling. Communication is limited to three narrow channels,
 * all configured here so nothing is hard-coded:
 *
 *   1. DIRECT DIAL — once a booking is funded and active, each party sees the
 *      other's real number and taps to call with their own dialler. Masked
 *      calling was removed 2026-08-12: a call from an unfamiliar virtual number
 *      reads as spam and goes unanswered, so masking actively destroyed the trust
 *      it was meant to protect. Contact is still gated (funded + active only).
 *   2. STRUCTURED STATUS UPDATES — tap-to-send preset messages ("On my way",
 *      "Arrived", …). No free-form typing anywhere. Each is immutable dispute
 *      evidence: a timestamped record of what was claimed and when.
 *   3. FREE-FORM → WHATSAPP — anything beyond the presets deep-links to the
 *      platform's existing WhatsApp channel. We do not build a messenger.
 */
return [

    // ── When may the parties reach each other at all? ────────────────────────
    // Contact opens only once money is custodied (§ anti-circumvention: no
    // contact before the platform is committed) and closes after the dispute
    // window lapses on a completed booking. This is what gates the phone number
    // now that there is no proxy layer in front of it.
    'contact_window' => [
        // Statuses in which the number + status updates are available.
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
    //   requires     — extra payload the client must supply ('duration')
    //   drives       — a booking lifecycle action this preset delegates to
    //                  ('start' | 'finish'); ties "Job started/finished" into the
    //                  HOURLY_CAPPED observed timer via BookingService (one impl).
    //
    // Every preset is a single tap. There is no free-text preset: the customer's
    // old LOCATION_NOTE was the only text that ever passed through the platform,
    // and it was removed with the messaging surfaces — free-form goes to WhatsApp.
    'status_presets' => [
        'ON_MY_WAY'   => ['role' => 'provider', 'label' => 'On my way',    'body' => 'Your provider is on the way.',                 'time_critical' => true],
        'ARRIVED'     => ['role' => 'provider', 'label' => 'Arrived',       'body' => 'Your provider has arrived.',                   'time_critical' => true],
        'RUNNING_LATE'=> ['role' => 'provider', 'label' => 'Running late',  'body' => 'Your provider is running about {mins} min late.', 'time_critical' => true, 'requires' => 'duration'],
        'JOB_STARTED' => ['role' => 'provider', 'label' => 'Job started',   'body' => 'Your provider has started the job.',           'drives' => 'start'],
        'JOB_FINISHED'=> ['role' => 'provider', 'label' => 'Job finished',  'body' => 'Your provider has marked the job finished.',   'drives' => 'finish'],
        'IM_READY'    => ['role' => 'customer', 'label' => "I'm ready",     'body' => 'The customer is ready for you.',               'time_critical' => true],
        'PLEASE_WAIT' => ['role' => 'customer', 'label' => 'Please wait',   'body' => 'The customer has asked you to wait a moment.', 'time_critical' => true],
    ],

    // Allowed durations (minutes) for the RUNNING_LATE preset. Config so the
    // choices are not baked into the clients.
    'late_durations' => [10, 15, 30],
];
