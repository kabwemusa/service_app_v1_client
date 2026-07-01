<?php

namespace App\Services\Gateway;

use App\Contracts\TrustEngine;
use App\Models\ProviderProfile;
use App\Models\ProviderVerification;
use App\Models\RiskTierConfig;
use App\Models\Service;

class StubTrustEngine implements TrustEngine
{
    public function checkEligibility(string $providerId, string $serviceId): array
    {
        $service = Service::with('category')->find($serviceId);
        if (! $service) {
            return ['eligible' => false, 'missing' => ['service_not_found'], 'tier' => 0, 'risk_tier' => 0];
        }

        $riskTier = $service->category->risk_tier ?? 1;
        $profile  = ProviderProfile::where('user_id', $providerId)->first();
        $trustTier = $profile?->trust_tier ?? 0;

        $config = RiskTierConfig::where('risk_tier', $riskTier)->first();
        if (! $config) {
            return ['eligible' => $trustTier >= 1, 'missing' => [], 'tier' => $trustTier, 'risk_tier' => $riskTier];
        }

        $required = $config->requirementsForTrustTier($trustTier);
        $verified = ProviderVerification::where('provider_id', $providerId)
            ->where('status', 'VERIFIED')
            ->pluck('verification_type')
            ->all();

        $missing = array_diff($required, $verified);

        return [
            'eligible'  => empty($missing) && $trustTier >= 1,
            'missing'   => array_values($missing),
            'tier'      => $trustTier,
            'risk_tier' => $riskTier,
        ];
    }

    public function publicSurface(string $providerId): array
    {
        $profile = ProviderProfile::where('user_id', $providerId)->first();
        $tier = $profile?->trust_tier ?? 0;

        $verifications = ProviderVerification::where('provider_id', $providerId)
            ->where('status', 'VERIFIED')
            ->pluck('verification_type')
            ->all();

        $facts = [];
        if (in_array('nrc', $verifications)) $facts[] = 'Identity verified';
        if (in_array('police_clearance', $verifications)) $facts[] = 'Police clearance on file';
        if (in_array('momo_name_match', $verifications)) $facts[] = 'Payment identity confirmed';
        if (in_array('portfolio', $verifications)) $facts[] = 'Portfolio reviewed';

        $badges = [];
        if ($tier >= 3) $badges[] = 'VERIFIED';
        if ($tier >= 4) $badges[] = 'PROFESSIONAL';

        return [
            'tier'           => $tier,
            'tier_label'     => \App\Enums\TrustTier::from($tier)->label(),
            'verified_facts' => $facts,
            'earned_badges'  => $badges,
        ];
    }

    public function recompute(string $providerId): void
    {
        // Phase 3: implement scoring algorithm
        // For now, trust_signals are populated but composite_score is not computed
    }
}
