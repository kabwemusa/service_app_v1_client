<?php

/**
 * Pricing-model SELECTION GUIDANCE + user-facing labels.
 *
 * The enum values (OUTCOME_FIXED / PROVIDER_SCOPE / HOURLY_CAPPED / QUOTE_DEPOSIT)
 * are the immutable backend contract — the pricing ENGINE is untouched. This file
 * carries only how those models are NAMED and RECOMMENDED to providers, so the
 * copy is one source of truth (admin-editable per category on top of these
 * defaults) and never hardcoded in the RN app / PWA / admin.
 *
 * The word "hourly" alone invites the wrong mental model (it rewards slowness),
 * so HOURLY_CAPPED always carries the "for open-ended jobs" qualifier below.
 */
return [

    // ── User-facing labels + descriptions (the relabel) ──────────────────────
    // `rationale` is the short "why this pays you fairly" line shown when a
    // category recommends the model. Categories may override rationale/warning.
    'models' => [
        'OUTCOME_FIXED' => [
            'label'       => 'Fixed price',
            'description' => "One price for the finished job. You're paid for the result, not the hours.",
            'rationale'   => "You're paid for the result — being fast doesn't cost you money.",
        ],
        'PROVIDER_SCOPE' => [
            'label'       => 'Price after you see the job',
            'description' => 'Customer describes the job; you send a price before they pay.',
            'rationale'   => 'Every job is different — look at the job, then send your price.',
        ],
        'HOURLY_CAPPED' => [
            'label'       => 'Time-based (for open-ended jobs)',
            'description' => "For work where nobody can know the scope upfront — like tracing a fault. You're paid for the time actually worked, up to an agreed maximum.",
            'rationale'   => "Nobody can know how long a fault takes to find — you're paid for the time it actually takes.",
        ],
        'QUOTE_DEPOSIT' => [
            'label'       => 'Quote with deposit',
            'description' => 'For big jobs — a deposit confirms the booking, the balance is paid on completion.',
            'rationale'   => 'For big jobs — a deposit confirms the booking, the balance is paid on completion.',
        ],
    ],

    // Fallbacks used when a category has no explicit guidance set yet.
    'default_model'          => 'OUTCOME_FIXED',
    'default_recommended'    => ['OUTCOME_FIXED', 'PROVIDER_SCOPE'],
    'default_mismatch_warning' =>
        "This isn't how most pros in this category price their work. The recommended model tends to pay you more fairly for the result rather than the clock. Want to switch?",
];
