<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * v3 Ranking Engine — §7.2
 *
 * S = w1·R_bayes + w2·C + w3·T - w4·ln(T_res+1)
 *   + w5·e^(-λ·t_inactive) + w6·D_proximity + N_boost + P_boost
 *
 * Trust score T — §5.4:
 *   T = 0.30·T_identity + 0.25·T_history + 0.20·T_reliability
 *     + 0.15·T_engagement + 0.10·T_tenure
 */
class RankingService
{
    private float $w1;
    private float $w2;
    private float $w3;
    private float $w4;
    private float $w5;
    private float $w6;
    private float $lambda;
    private int   $minReviews;
    private float $coldStartBoost;
    private int   $coldStartThreshold;
    private float $promoBoost;
    private float $fairnessNewReserve;

    public function __construct()
    {
        $cfg = config('search.ranking');

        $this->w1                 = $cfg['w1_bayes'];
        $this->w2                 = $cfg['w2_completion'];
        $this->w3                 = $cfg['w3_trust'];
        $this->w4                 = $cfg['w4_response'];
        $this->w5                 = $cfg['w5_activity'];
        $this->w6                 = $cfg['w6_proximity'];
        $this->lambda             = $cfg['lambda'];
        $this->minReviews         = $cfg['min_reviews'];
        $this->coldStartBoost     = $cfg['cold_start_boost'];
        $this->coldStartThreshold = $cfg['cold_start_threshold'];
        $this->promoBoost         = $cfg['promo_boost'];
        $this->fairnessNewReserve = $cfg['fairness_new_reserve'];
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Bayesian normalized rating (unchanged from v2).
     */
    public function computeRBayes(float $rRaw, int $vReviews, float $cMean): float
    {
        $m = $this->minReviews;

        return ($vReviews / ($vReviews + $m)) * $rRaw
             + ($m        / ($vReviews + $m)) * $cMean;
    }

    /**
     * v3 Composite Trust Score T ∈ [0, 1]  — §5.4
     *
     * Used as the T term in the main sort formula.
     * This value is also stored nightly in provider_profiles.trust_score.
     */
    public function computeTrustScore(
        int   $trustTier,
        float $rRaw,
        int   $vReviews,
        float $cMean,
        float $completionRate,
        float $responseRate7d,
        float $cancellationRate30d,
        int   $responseTimeP50Mins,
        int   $completedJobs,
    ): float {
        // T_identity — tier step function
        $tIdentity = match(true) {
            $trustTier >= 4 => 1.00,
            $trustTier === 3 => 0.90,
            $trustTier === 2 => 0.70,
            $trustTier === 1 => 0.40,
            default         => 0.00,
        };

        // T_history — Bayesian rating normalised to [0,1]
        $rBayes   = $this->computeRBayes($rRaw, $vReviews, $cMean);
        $tHistory = ($rBayes - 1.0) / 4.0;  // maps [1,5] → [0,1]

        // T_reliability
        $tReliability = 0.5 * $completionRate
                      + 0.3 * $responseRate7d
                      + 0.2 * (1.0 - $cancellationRate30d);

        // T_engagement — logistic of P50 response time
        $tEngagement = 1.0 / (1.0 + exp(0.02 * ($responseTimeP50Mins - 30)));

        // T_tenure — full credit at 50 completed jobs
        $tTenure = min(1.0, $completedJobs / 50.0);

        $trust = 0.30 * $tIdentity
               + 0.25 * $tHistory
               + 0.20 * $tReliability
               + 0.15 * $tEngagement
               + 0.10 * $tTenure;

        return max(0.0, min(1.0, $trust));
    }

    /**
     * Full v3 composite sort score S.
     *
     * @param  float   $distanceKm      Distance from search point to service location.
     * @param  float   $maxRadiusKm     Query radius (for normalising proximity).
     * @param  float   $trustScore      Pre-computed trust_score (from provider_profiles or live).
     * @param  bool    $hasPromoSlot    Whether provider has an active promoted_slots row.
     * @param  int     $completedJobs   For cold-start boost check.
     * @param  float   $tResHours       Avg response time in hours (0 until nightly data populated).
     */
    public function computeScore(
        float $rRaw,
        int   $vReviews,
        float $completionRate,
        ?float $lastActiveAt,
        int   $completedJobs,
        float $cMean,
        float $trustScore      = 0.0,
        float $distanceKm      = 0.0,
        float $maxRadiusKm     = 10.0,
        bool  $hasPromoSlot    = false,
        int   $trustTier       = 0,
        float $tResHours       = 0.0,
    ): float {
        $rBayes    = $this->computeRBayes($rRaw, $vReviews, $cMean);
        $tInactive = $this->daysInactive($lastActiveAt);

        // Proximity: 1 - clipped(distance / radius)
        $proximity = 1.0 - min(1.0, $maxRadiusKm > 0 ? $distanceKm / $maxRadiusKm : 0.0);

        // Cold-start boost: new but verified provider
        $nBoost = ($completedJobs < $this->coldStartThreshold && $trustTier >= 1)
            ? $this->coldStartBoost
            : 0.0;

        // Promoted-slot boost
        $pBoost = $hasPromoSlot ? $this->promoBoost : 0.0;

        return $this->w1 * $rBayes
             + $this->w2 * $completionRate
             + $this->w3 * $trustScore
             - $this->w4 * log($tResHours + 1)
             + $this->w5 * exp(-$this->lambda * $tInactive)
             + $this->w6 * $proximity
             + $nBoost
             + $pBoost;
    }

    /**
     * Apply the §7.3 fairness floor to the top-20 results.
     *
     * Ensures at least 20% of the top tranche are new providers
     * (< 10 completed jobs), interleaved after initial sort.
     *
     * @param  array   $sorted       Already sorted by score DESC.
     * @param  array   $jobCountMap  providerId => completed_job_count
     */
    public function applyFairnessFloor(array $sorted, array $jobCountMap): array
    {
        $topN        = 20;
        $newThreshold = 10;
        $minNew      = (int) ceil($topN * $this->fairnessNewReserve); // 20% → 4

        if (count($sorted) <= $topN) {
            return $sorted;
        }

        $top  = array_slice($sorted, 0, $topN);
        $rest = array_slice($sorted, $topN);

        $established = array_values(array_filter($top, fn($r) => ($jobCountMap[$r->provider_id] ?? 0) >= $newThreshold));
        $newProviders = array_values(array_filter($top, fn($r) => ($jobCountMap[$r->provider_id] ?? 0) < $newThreshold));

        // If there are already enough new providers, no change needed
        if (count($newProviders) >= $minNew) {
            return $sorted;
        }

        // Pull additional new providers from the rest of the list
        $needed = $minNew - count($newProviders);
        foreach ($rest as $key => $row) {
            if ($needed <= 0) break;
            if (($jobCountMap[$row->provider_id] ?? 0) < $newThreshold) {
                $newProviders[] = $row;
                unset($rest[$key]);
                $needed--;
            }
        }

        // Interleave: place one new provider every 4 positions in the top tranche
        $interleaved = [];
        $newIdx      = 0;
        $estIdx      = 0;
        for ($i = 0; $i < $topN; $i++) {
            if (($i + 1) % 4 === 0 && $newIdx < count($newProviders)) {
                $interleaved[] = $newProviders[$newIdx++];
            } elseif ($estIdx < count($established)) {
                $interleaved[] = $established[$estIdx++];
            } elseif ($newIdx < count($newProviders)) {
                $interleaved[] = $newProviders[$newIdx++];
            }
        }

        return array_merge($interleaved, array_values($rest));
    }

    /**
     * Apply §7.5 same-provider diversity: no more than 2 consecutive
     * results from the same provider.
     */
    public function applyProviderDiversity(array $results): array
    {
        $out          = [];
        $deferred     = [];
        $consecutives = [];

        foreach ($results as $row) {
            $pid = $row->provider_id;
            $consecutives[$pid] = ($consecutives[$pid] ?? 0) + 1;

            if ($consecutives[$pid] > 2) {
                $deferred[] = $row;
            } else {
                $out[] = $row;
            }
        }

        return array_merge($out, $deferred);
    }

    /**
     * Platform-wide average rating — hourly Redis cache.
     */
    public function getCMean(): float
    {
        $ttl = config('search.ranking.c_mean_ttl_seconds', 3600);

        return Cache::remember('ranking:c_mean', $ttl, fn () => $this->recalculateCMean());
    }

    public function invalidateCMean(): void
    {
        Cache::forget('ranking:c_mean');
    }

    public function getCachedScore(string $providerId, callable $computeFn): float
    {
        $ttl = config('search.ranking.provider_score_ttl', 3600);
        $key = "ranking:score:{$providerId}";

        return Cache::remember($key, $ttl, $computeFn);
    }

    public function invalidateProviderScore(string $providerId): void
    {
        Cache::forget("ranking:score:{$providerId}");
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function recalculateCMean(): float
    {
        try {
            $result = DB::selectOne("
                SELECT COALESCE(AVG(u.r_raw), 0.00) AS c_mean
                FROM   users u
                JOIN   provider_profiles pp ON pp.user_id = u.id
                WHERE  pp.trust_tier >= 1
                  AND  u.v_reviews   > 0
            ");

            return $result ? (float) $result->c_mean : 0.0;
        } catch (\Throwable $e) {
            Log::error('RankingService::recalculateCMean failed', ['error' => $e->getMessage()]);
            return 0.0;
        }
    }

    private function daysInactive(?float $lastActiveAtTimestamp): float
    {
        if ($lastActiveAtTimestamp === null) {
            return 30.0;
        }

        return max(0, time() - (int) $lastActiveAtTimestamp) / 86400.0;
    }
}
