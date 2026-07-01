<?php

namespace App\Contracts;

interface TrustEngine
{
    /**
     * Check if a provider meets the eligibility requirements for a service's risk tier.
     *
     * @param  string  $providerId
     * @param  string  $serviceId
     * @return array{eligible: bool, missing: string[], tier: int, risk_tier: int}
     */
    public function checkEligibility(string $providerId, string $serviceId): array;

    /**
     * Get the public-safe trust surface for a provider.
     * Returns tier + verified facts — NEVER raw scores.
     *
     * @param  string  $providerId
     * @return array{tier: int, tier_label: string, verified_facts: string[], earned_badges: string[]}
     */
    public function publicSurface(string $providerId): array;

    /**
     * Compute and store trust signals for a provider.
     * Called by scheduled jobs — not by request handlers.
     *
     * @param  string  $providerId
     * @return void
     */
    public function recompute(string $providerId): void;
}
