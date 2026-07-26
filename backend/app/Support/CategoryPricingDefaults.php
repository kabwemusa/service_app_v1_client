<?php

namespace App\Support;

/**
 * Seed defaults for category-driven pricing-model guidance, by the NATURE of the
 * work. This is the SEED only — admin can tune every field per category at
 * runtime (CategoryController, audited). Shared by the backfill migration and
 * CategorySeeder so the two never drift.
 *
 *   default     — the model a new service in this category is pre-selected to.
 *   recommended — the set that does NOT trigger the mismatch nudge.
 *   warning     — benefit-framed nudge shown when an ill-suited model is picked
 *                 (null → falls back to config('pricing.default_mismatch_warning')).
 */
final class CategoryPricingDefaults
{
    /** @return array<string, array{default: string, recommended: array<int,string>, warning: ?string}> */
    public static function map(): array
    {
        return [
            // ── Outcome / creative / defined-scope → FIXED PRICE ─────────────
            'graphic-design' => [
                'default'     => 'OUTCOME_FIXED',
                'recommended' => ['OUTCOME_FIXED', 'PROVIDER_SCOPE'],
                'warning'     => "Most designers charge a fixed price per project. On time-based pricing you'd earn the same whether a logo takes 20 minutes or 4 hours — your speed and skill wouldn't count. Charge a fixed price instead?",
            ],
            'hair-beauty' => [
                'default'     => 'OUTCOME_FIXED',
                'recommended' => ['OUTCOME_FIXED'],
                'warning'     => "Most stylists charge a fixed price per style. Time-based pricing would pay the same whether a cut takes 20 minutes or two hours — being fast wouldn't reward you. Set a fixed price instead?",
            ],
            'tutoring' => [
                'default'     => 'OUTCOME_FIXED',
                'recommended' => ['OUTCOME_FIXED'],
                'warning'     => "Most tutors charge a fixed price per session. On time-based pricing a clearer, faster lesson would earn you less — your experience wouldn't be rewarded. Charge per session instead?",
            ],
            'photography' => [
                'default'     => 'OUTCOME_FIXED',
                'recommended' => ['OUTCOME_FIXED', 'PROVIDER_SCOPE'],
                'warning'     => "Most photographers charge a fixed price per shoot. Time-based pricing pays the same whether you're quick or slow — a per-shoot price rewards your skill. Set a fixed price instead?",
            ],
            'cleaning' => [
                'default'     => 'OUTCOME_FIXED',
                'recommended' => ['OUTCOME_FIXED', 'PROVIDER_SCOPE', 'QUOTE_DEPOSIT'],
                'warning'     => "Most cleaners charge a fixed price for a defined job. Time-based pricing pays the same whether you work fast or slow — a set price rewards efficiency. Charge a fixed price instead?",
            ],
            'laundry' => [
                'default'     => 'OUTCOME_FIXED',
                'recommended' => ['OUTCOME_FIXED'],
                'warning'     => null,
            ],
            'gardening' => [
                'default'     => 'OUTCOME_FIXED',
                'recommended' => ['OUTCOME_FIXED', 'PROVIDER_SCOPE'],
                'warning'     => null,
            ],
            'delivery' => [
                'default'     => 'OUTCOME_FIXED',
                'recommended' => ['OUTCOME_FIXED'],
                'warning'     => null,
            ],
            'transport' => [
                'default'     => 'OUTCOME_FIXED',
                'recommended' => ['OUTCOME_FIXED', 'PROVIDER_SCOPE'],
                'warning'     => null,
            ],

            // ── Diagnostic / unknowable scope → TIME-BASED (capped) ──────────
            'plumbing' => [
                'default'     => 'HOURLY_CAPPED',
                'recommended' => ['HOURLY_CAPPED', 'PROVIDER_SCOPE'],
                'warning'     => "For fault-finding work, nobody can know the time upfront. A fixed price risks you working for free when a job turns out complicated — time-based (capped) protects you. Switch to time-based?",
            ],
            'electrical' => [
                'default'     => 'HOURLY_CAPPED',
                'recommended' => ['HOURLY_CAPPED', 'PROVIDER_SCOPE'],
                'warning'     => "Electrical faults can't be scoped until you're on site. A fixed price risks you losing out on a tricky job — time-based (capped) pays you for the time it actually takes. Switch to time-based?",
            ],
            'tech-support' => [
                'default'     => 'HOURLY_CAPPED',
                'recommended' => ['HOURLY_CAPPED', 'OUTCOME_FIXED', 'PROVIDER_SCOPE'],
                'warning'     => null,
            ],

            // ── Large / multi-day / site-visit → QUOTE WITH DEPOSIT ──────────
            'catering' => [
                'default'     => 'PROVIDER_SCOPE',
                'recommended' => ['PROVIDER_SCOPE', 'QUOTE_DEPOSIT', 'OUTCOME_FIXED'],
                'warning'     => null,
            ],
            'security' => [
                'default'     => 'PROVIDER_SCOPE',
                'recommended' => ['PROVIDER_SCOPE', 'OUTCOME_FIXED', 'QUOTE_DEPOSIT'],
                'warning'     => null,
            ],
        ];
    }
}
