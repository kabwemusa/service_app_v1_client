<?php

namespace App\Services\Dispatch;

use App\Contracts\TrustEngine;
use App\Enums\TrustTier;
use App\Models\Booking;
use App\Models\ProviderProfile;
use App\Models\ProviderVerification;
use App\Models\Review;
use App\Models\RiskTierConfig;
use App\Models\Service;
use App\Models\TrustSignal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class RealTrustEngine implements TrustEngine
{
    // ── Eligibility gate (hard pass/fail) ────────────────────────────────────

    public function checkEligibility(string $providerId, string $serviceId): array
    {
        $service = Service::with('category')->find($serviceId);
        if (! $service) {
            return ['eligible' => false, 'missing' => ['service_not_found'], 'tier' => 0, 'risk_tier' => 0];
        }

        $riskTier  = (int) ($service->category->risk_tier ?? 1);
        $profile   = ProviderProfile::where('user_id', $providerId)->first();
        $trustTier = $profile?->trust_tier ?? 0;

        if ($trustTier < 1) {
            return ['eligible' => false, 'missing' => ['unverified'], 'tier' => $trustTier, 'risk_tier' => $riskTier];
        }

        $config = RiskTierConfig::where('risk_tier', $riskTier)->first();
        if (! $config) {
            return ['eligible' => $trustTier >= 1, 'missing' => [], 'tier' => $trustTier, 'risk_tier' => $riskTier];
        }

        $required = $config->requirementsForTrustTier($trustTier);
        $verified = ProviderVerification::where('provider_id', $providerId)
            ->where('status', 'VERIFIED')
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->pluck('verification_type')
            ->all();

        // The identity base (nrc / momo_name_match / selfie_match) is
        // authoritatively established by KYC approval. A KYC-VERIFIED provider
        // satisfies these even when the normalized provider_verifications bridge
        // rows were never written (panel-approved or seeded providers) — otherwise
        // an already-listed provider's own service falsely fails the booking gate.
        // Higher-tier gates (portfolio, police_clearance) still need their own
        // explicit verification and are never auto-granted here.
        if ($profile->kyc_status === 'VERIFIED') {
            $verified = array_values(array_unique(array_merge(
                $verified,
                ['nrc', 'momo_name_match', 'selfie_match'],
            )));
        }

        $missing = array_values(array_diff($required, $verified));

        return [
            'eligible'  => empty($missing),
            'missing'   => $missing,
            'tier'      => $trustTier,
            'risk_tier' => $riskTier,
        ];
    }

    // ── Public surface (tier + facts only — NEVER scores) ───────────────────

    public function publicSurface(string $providerId): array
    {
        $profile = ProviderProfile::where('user_id', $providerId)->first();
        $tier    = $profile?->trust_tier ?? 0;

        $verifications = ProviderVerification::where('provider_id', $providerId)
            ->where('status', 'VERIFIED')
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->pluck('verification_type')
            ->all();

        $facts = [];
        if (in_array('nrc', $verifications))              $facts[] = 'Identity verified';
        if (in_array('police_clearance', $verifications)) $facts[] = 'Police clearance on file';
        if (in_array('momo_name_match', $verifications))  $facts[] = 'Payment identity confirmed';
        if (in_array('portfolio', $verifications))        $facts[] = 'Portfolio reviewed';

        $badges = [];
        if ($tier >= 3) $badges[] = 'VERIFIED';
        if ($tier >= 4) $badges[] = 'PROFESSIONAL';

        $signal = TrustSignal::find($providerId);
        $completedJobs = $signal?->rating_count ?? 0;
        if ($completedJobs < config('dispatch.fairness.probation_jobs', 10)) {
            $badges[] = 'NEW';
        }

        return [
            'tier'           => $tier,
            'tier_label'     => TrustTier::from($tier)->label(),
            'verified_facts' => $facts,
            'earned_badges'  => $badges,
        ];
    }

    // ── Compute + store trust signals ───────────────────────────────────────

    public function recompute(string $providerId): void
    {
        $profile = ProviderProfile::where('user_id', $providerId)->first();
        if (! $profile) return;

        $trustTier = $profile->trust_tier ?? 0;

        $identity   = $this->computeIdentityStrength($providerId);
        $reliability = $this->computeReliability($providerId);
        $financial  = $this->computeFinancialHealth($providerId);
        $rating     = $this->computeBayesianRating($providerId);

        $weights = $this->weightsForTier($trustTier);

        $composite = ($identity   * $weights['identity'])
                   + ($reliability * $weights['reliability'])
                   + ($financial  * $weights['financial'])
                   + ($rating['score'] * $weights['ratings']);

        $decayDays = $this->daysSinceLastJob($providerId);
        $lambda    = config('dispatch.scoring.decay_lambda', 0.005);
        $composite *= exp(-$lambda * $decayDays);

        $composite = round(max(0, min(100, $composite)), 2);

        TrustSignal::updateOrCreate(
            ['provider_id' => $providerId],
            [
                'identity_strength' => round($identity, 2),
                'reliability_pct'   => round($reliability, 2),
                'on_time_pct'       => round($reliability, 2),
                'dispute_rate'      => round(100 - $financial, 2),
                'financial_health'  => round($financial, 2),
                'bayesian_rating'   => round($rating['score'], 2),
                'rating_count'      => $rating['count'],
                'composite_score'   => $composite,
                'last_computed_at'  => now(),
            ],
        );

        Log::debug('RealTrustEngine::recompute', [
            'provider' => $providerId,
            'identity' => $identity,
            'reliability' => $reliability,
            'financial' => $financial,
            'rating' => $rating['score'],
            'composite' => $composite,
        ]);
    }

    public function compositeScore(string $providerId): float
    {
        $signal = TrustSignal::find($providerId);
        if ($signal && $signal->last_computed_at && $signal->last_computed_at->diffInHours(now()) < 24) {
            return $signal->composite_score;
        }

        $this->recompute($providerId);
        return TrustSignal::find($providerId)?->composite_score ?? 0;
    }

    // ── Sub-score computations ──────────────────────────────────────────────

    private function computeIdentityStrength(string $providerId): float
    {
        $verified = ProviderVerification::where('provider_id', $providerId)
            ->where('status', 'VERIFIED')
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->pluck('verification_type')
            ->all();

        $score = 0;
        if (in_array('nrc', $verified))              $score += 30;
        if (in_array('momo_name_match', $verified))  $score += 20;
        if (in_array('portfolio', $verified))        $score += 20;
        if (in_array('police_clearance', $verified)) $score += 20;
        if (in_array('selfie_match', $verified))     $score += 10;

        return min(100, $score);
    }

    private function computeReliability(string $providerId): float
    {
        $total = Booking::where('provider_id', $providerId)
            ->whereIn('status', ['COMPLETED', 'DISBURSED', 'CANCELLED', 'DECLINED', 'NO_SHOW', 'EXPIRED'])
            ->count();

        if ($total === 0) {
            $prior = config('dispatch.scoring.reliability_prior', 70);
            return (float) $prior;
        }

        $completed = Booking::where('provider_id', $providerId)
            ->whereIn('status', ['COMPLETED', 'DISBURSED'])
            ->count();

        $cancelled = Booking::where('provider_id', $providerId)
            ->where('status', 'CANCELLED')
            ->count();

        $noShow = Booking::where('provider_id', $providerId)
            ->where('status', 'NO_SHOW')
            ->count();

        $raw = ($completed / $total) * 100;

        $penalty = ($cancelled * 5) + ($noShow * 15);
        $raw = max(0, $raw - $penalty);

        $k = config('dispatch.scoring.shrink_k', 5);
        $prior = config('dispatch.scoring.reliability_prior', 70);
        $shrunk = (($raw * $total) + ($prior * $k)) / ($total + $k);

        return min(100, $shrunk);
    }

    private function computeFinancialHealth(string $providerId): float
    {
        $totalBookings = Booking::where('provider_id', $providerId)
            ->whereIn('status', ['COMPLETED', 'DISBURSED', 'DISPUTED'])
            ->count();

        if ($totalBookings === 0) {
            return (float) config('dispatch.scoring.financial_prior', 80);
        }

        $disputes = Booking::where('provider_id', $providerId)
            ->where('status', 'DISPUTED')
            ->count();

        $chargebacks = DB::table('disputes')
            ->where('against', $providerId)
            ->where('reason_category', 'CHARGEBACK')
            ->count();

        $rawRate = ($disputes + ($chargebacks * 2)) / $totalBookings;

        $k = config('dispatch.scoring.shrink_k', 5);
        $prior = config('dispatch.scoring.dispute_prior', 0.05);
        $shrunkRate = (($rawRate * $totalBookings) + ($prior * $k)) / ($totalBookings + $k);

        $health = max(0, 100 - ($shrunkRate * 500));

        return min(100, $health);
    }

    private function computeBayesianRating(string $providerId): array
    {
        $reviews = Review::where('reviewee_id', $providerId)->get();
        $count = $reviews->count();

        if ($count === 0) {
            $prior = config('dispatch.scoring.rating_prior', 3.5);
            return ['score' => $prior / 5 * 100, 'count' => 0];
        }

        $halfLifeDays = config('dispatch.scoring.rating_half_life_days', 180);
        $weightedSum = 0;
        $weightTotal = 0;

        foreach ($reviews as $review) {
            $ageInDays = $review->created_at->diffInDays(now());
            $weight = exp(-0.693 * $ageInDays / max($halfLifeDays, 1));
            $weightedSum += $review->rating * $weight;
            $weightTotal += $weight;
        }

        $rawAvg = $weightTotal > 0 ? $weightedSum / $weightTotal : 3.5;

        $k = config('dispatch.scoring.shrink_k', 5);
        $prior = config('dispatch.scoring.rating_prior', 3.5);
        $bayesian = (($rawAvg * $count) + ($prior * $k)) / ($count + $k);

        $score = ($bayesian / 5) * 100;

        return ['score' => min(100, max(0, $score)), 'count' => $count];
    }

    private function weightsForTier(int $tier): array
    {
        $key = "dispatch.scoring.weights.tier_{$tier}";
        $defaults = match ($tier) {
            1       => ['identity' => 0.15, 'reliability' => 0.30, 'financial' => 0.20, 'ratings' => 0.35],
            2       => ['identity' => 0.25, 'reliability' => 0.25, 'financial' => 0.20, 'ratings' => 0.30],
            3, 4    => ['identity' => 0.40, 'reliability' => 0.25, 'financial' => 0.20, 'ratings' => 0.15],
            default => ['identity' => 0.25, 'reliability' => 0.25, 'financial' => 0.25, 'ratings' => 0.25],
        };

        // § CFG-2 — read the admin-editable override first (trust_weight_tier_N,
        // keys 1..4), then the config default. Admin edits are validated to sum to 1.0.
        $override = \App\Support\Settings::get("trust_weight_tier_{$tier}");
        if (is_array($override)
            && array_diff(['identity', 'reliability', 'financial', 'ratings'], array_keys($override)) === []) {
            return $override;
        }

        return config($key, $defaults);
    }

    private function daysSinceLastJob(string $providerId): int
    {
        $lastCompleted = Booking::where('provider_id', $providerId)
            ->whereIn('status', ['COMPLETED', 'DISBURSED'])
            ->latest('completed_at')
            ->value('completed_at');

        if (! $lastCompleted) return 90;

        return (int) now()->diffInDays($lastCompleted);
    }
}
