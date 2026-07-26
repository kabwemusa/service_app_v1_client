<?php

/**
 * Booking Agreement document (a.k.a. "Service Confirmation").
 *
 * Generated server-side the moment a booking is confirmed (funds custodied),
 * from REAL booking data only — nothing invented. Immutable + stored; a NEW
 * versioned document is generated on any material change (approved quote, cap
 * extension, reschedule). Downloadable by BOTH parties on app, PWA and via a
 * WhatsApp document message.
 *
 * ⚠ LEGAL: this records the booking the parties agreed on the platform. It must
 * NOT assert that it is a "legally binding contract" in code or UI until a
 * qualified Zambian lawyer approves the wording/framing (see LEGAL_REVIEW.md,
 * item "Booking Agreement document"). All wording below is placeholder scaffold.
 */
return [
    // Rendering engine. 'dompdf' → a real PDF via the Dompdf engine.
    // 'html' → a self-contained print-ready HTML artifact (fallback when the PDF
    // engine is unavailable). Selected without any code change.
    'renderer' => env('AGREEMENT_RENDERER', 'dompdf'),

    // Private storage disk + path the immutable documents live on. Served ONLY
    // through the authorized, party-scoped download routes — never a public URL
    // (except the short-lived signed link handed to WhatsApp/Meta to fetch).
    'disk' => env('AGREEMENT_DISK', 'local'),
    'path' => 'booking_agreements',

    // How long the signed URL handed to WhatsApp (so Meta can fetch the media)
    // stays valid. Kept short because a signed link is fetchable by anyone with
    // the URL during the window.
    'whatsapp_link_ttl_minutes' => (int) env('AGREEMENT_WHATSAPP_LINK_TTL', 30),

    // Whether to push the document out over WhatsApp as a document message on
    // generation. Off by default until the media-fetch link strategy is signed
    // off (see LEGAL_REVIEW.md). When off, the WhatsApp leg still sends a
    // notification with an in-app deep link instead of the raw file.
    'whatsapp_document' => (bool) env('AGREEMENT_WHATSAPP_DOCUMENT', false),

    // Document identity + framing. All copy is config so counsel can adjust
    // wording without a code change once approved.
    'brand' => [
        'company'  => env('AGREEMENT_COMPANY', 'Sebenza Technologies Ltd'),
        'product'  => env('AGREEMENT_PRODUCT', 'Sebenza'),
        // The UI/label name. Deliberately NOT "contract" — see LEGAL note above.
        'title'    => 'Booking Agreement',
        'subtitle' => 'Service Confirmation',
    ],

    // Fixed framing paragraphs (placeholder scaffold — counsel to finalise).
    // No unapproved legal claims: this states what the record IS, not its legal
    // enforceability.
    'copy' => [
        'preamble'  => 'This document records the booking the parties agreed on the :product platform. It is generated automatically from the confirmed booking details and is provided to both the customer and the provider for their records.',
        'escrow'    => 'The amount shown is held in escrow by the platform\'s licensed payment provider and is released to the provider once the booking is completed and confirmed, subject to the cancellation and refund terms.',
        'terms_ref' => 'This booking is subject to the :product Terms of Service (version :version, effective :effective) which both parties accepted.',
        // Explicitly NON-binding-claim footer until counsel approves framing.
        'footer'    => 'This is a record of a booking made through :product. It is not a substitute for legal advice. Wording is pending review by qualified Zambian counsel.',
    ],
];
