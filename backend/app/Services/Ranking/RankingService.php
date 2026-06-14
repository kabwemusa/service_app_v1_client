<?php

namespace App\Services\Ranking;

use App\Enums\TrustTier;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * v3.2 §1.3 Ranking Engine — corrected composite score.
 *
 * Every feature is normalized to [0,1] before weighting:
 *
 *   r    = (R_bayes − 1) / 4
 *   c    = completion_rate_shrunk          (§4.1 shrinkage)
 *   ver  = tier step T1=0.4 T2=0.7 T3=0.9 T4=1.0   (identity only — §1.2 de-dup)
 *   resp = 1 / (1 + e^(0.02·(p50 − 30)))
 *   f    = e^(−λ · days_inactive)
 *   d    = e^(−d_km / d₀)                  (§1.6 exponential proximity)
 *   p    = price_fit (Phase 3 — 0.5 constant behind RANK_PRICE_FIT_ENABLED)
 *
 *   S_organic = 0.25r + 0.15c + 0.15ver + 0.10resp + 0.05f + 0.20d + 0.10p
 *   S         = (S_organic + B_cold + B_personal) × M_tier
 *
 * There is deliberately NO promoted boost here (§1.5): promoted placement is
 * reserved-slot inventory (Phase 1), never an organic score addend.
 *
 * `trust_score` (v3 §5.4) remains the gating/account-health metric — the 0.40
 * search floor and the 0.25 restriction trigger — but it is NOT a ranking
 * term; only its non-overlapping identity component (ver) ranks (§1.2).
 */
class RankingService
{
    private array $w;
    private float $coldBoost;
    private int   $coldJobThreshold;
    private float $tier1Multiplier;
    private float $d0DefaultKm;
    private bool  $priceFitEnabled;
    private int   $shrinkK;
    private float $shrinkCompletionPrior;
    private float $shrinkResponsePrior;
    private int   $minReviews;
    private float $freshnessLambda;
    private float $trustScoreFloor;
    private array $fairnessSlots;
    private int   $newProviderJobs;
    private int   $maxConsecutive;

    public function __construct()
    {
        $cfg = config('ranking');

        $this->w                     = $cfg['weights'];
        $this->coldBoost             = $cfg['cold_boost'];
        $this->coldJobThreshold      = $cfg['cold_job_threshold'];
        $this->tier1Multiplier       = $cfg['tier1_multiplier'];
        $this->d0DefaultKm           = $cfg['proximity_d0_default_km'];
        $this->priceFitEnabled       = $cfg['price_fit_enabled'];
        $this->shrinkK               = $cfg['shrink_k'];
        $this->shrinkCompletionPrior = $cfg['shrink_completion_prior'];
        $this->shrinkResponsePrior   = $cfg['shrink_response_prior'];
        $this->minReviews            = $cfg['min_reviews'];
        $this->freshnessLambda       = $cfg['freshness_lambda'];
        $this->trustScoreFloor       = $cfg['trust_score_floor'];
        $this->fairnessSlots         = $cfg['fairness_slots'];
        $this->newProviderJobs       = $cfg['new_provider_jobs'];
        $this->maxConsecutive        = $cfg['max_consecutive_per_provider'];
    }

    // ── Composite score ──────────────────────────────────────────────────────

    /**
     * Full per-component breakdown of the v3.2 §1.3 score. This is the single
     * scoring entry point; it also feeds the impressions log (Phase 1) and the
     * admin debug view, so every component must appear in the output.
     *
     * @param float      $rBayes        Bayesian (recency-decayed from Phase 2) rating ∈ [1,5]
     * @param float      $completionShrunk Already-shrunk completion rate ∈ [0,1] (see shrunkCompletionRate())
     * @param int        $trustTier     0–4
     * @param int        $p50Mins       Median response time; pass categoryP50Prior() when the provider has no data
     * @param float      $daysInactive  Days since last_active_at (30 when unknown)
     * @param float|null $distanceKm    Straight-line distance to delivery location L; null = no location (d = 0)
     * @param float|null $d0Km          Category decay constant; null = config default (per-category in Phase 1)
     * @param int        $completedJobs For B_cold
     * @param float      $bPersonal     Phase 2 personalization boost — keep 0.0 until then
     * @param float|null $priceFit      Phase 3 price-fit ∈ [0,1]; ignored while the flag is off
     */
    public function scoreBreakdown(
        float  $rBayes,
        float  $completionShrunk,
        int    $trustTier,
        int    $p50Mins,
        float  $daysInactive,
        ?float $distanceKm,
        ?float $d0Km,
        int    $completedJobs,
        float  $bPersonal = 0.0,
        ?float $priceFit  = null,
    ): array {
        $r    = $this->normalizeRating($rBayes);
        $c    = $this->clamp01($completionShrunk);
        $ver  = $this->verificationStep($trustTier);
        $resp = $this->responseTerm($p50Mins);
        $f    = $this->freshnessTerm($daysInactive);
        $d    = $this->proximityTerm($distanceKm, $d0Km);
        $p    = $this->priceTerm($priceFit);

        $sOrganic = $this->w['rating']       * $r
                  + $this->w['completion']   * $c
                  + $this->w['verification'] * $ver
                  + $this->w['response']     * $resp
                  + $this->w['freshness']    * $f
                  + $this->w['proximity']    * $d
                  + $this->w['price']        * $p;

        $bCold = ($completedJobs < $this->coldJobThreshold && $trustTier >= TrustTier::BASIC->value)
            ? $this->coldBoost
            : 0.0;

        $mTier = $trustTier === TrustTier::BASIC->value ? $this->tier1Multiplier : 1.0;

        $score = ($sOrganic + $bCold + $bPersonal) * $mTier;

        return [
            'r'          => $r,
            'c'          => $c,
            'ver'        => $ver,
            'resp'       => $resp,
            'f'          => $f,
            'd'          => $d,
            'p'          => $p,
            's_organic'  => $sOrganic,
            'b_cold'     => $bCold,
            'b_personal' => $bPersonal,
            'm_tier'     => $mTier,
            'score'      => $score,
        ];
    }

    /** Convenience wrapper — final S only. */
    public function score(...$args): float
    {
        return $this->scoreBreakdown(...$args)['score'];
    }

    // ── Feature normalizers (each individually testable) ────────────────────

    /** r = (R_bayes − 1) / 4, clamped to [0,1]. */
    public function normalizeRating(float $rBayes): float
    {
        return $this->clamp01(($rBayes - 1.0) / 4.0);
    }

    /** ver — tier step function (the only trust component in ranking, §1.2). */
    public function verificationStep(int $trustTier): float
    {
        return match (true) {
            $trustTier >= 4  => 1.00,
            $trustTier === 3 => 0.90,
            $trustTier === 2 => 0.70,
            $trustTier === 1 => 0.40,
            default          => 0.00,
        };
    }

    /** resp = 1 / (1 + e^(0.02·(p50 − 30))) — bounded; replaces −ln(T_res+1). */
    public function responseTerm(int $p50Mins): float
    {
        return 1.0 / (1.0 + exp(0.02 * ($p50Mins - 30)));
    }

    /** f = e^(−λ · days_inactive). */
    public function freshnessTerm(float $daysInactive): float
    {
        return exp(-$this->freshnessLambda * max(0.0, $daysInactive));
    }

    /**
     * d = e^(−d_km / d₀) — §1.6 exponential decay (4 km half-feel by default).
     * No known delivery location → no proximity signal (0).
     */
    public function proximityTerm(?float $distanceKm, ?float $d0Km = null): float
    {
        if ($distanceKm === null) {
            return 0.0;
        }

        $d0 = $d0Km ?? $this->d0DefaultKm;

        return exp(-max(0.0, $distanceKm) / max(0.1, $d0));
    }

    /** p — Phase 3 price-fit; constant 0.5 while RANK_PRICE_FIT_ENABLED=false. */
    public function priceTerm(?float $priceFit): float
    {
        if (! $this->priceFitEnabled || $priceFit === null) {
            return 0.5;
        }

        return $this->clamp01($priceFit);
    }

    // ── §4.1 cold-start shrinkage priors ─────────────────────────────────────

    /**
     * completion_rate_shrunk = (completed + k·prior) / (total + k), k = 5.
     * With no history this is exactly the 0.85 prior — credible but unproven.
     */
    public function shrunkCompletionRate(int $completedJobs, int $totalEndedJobs): float
    {
        return ($completedJobs + $this->shrinkK * $this->shrinkCompletionPrior)
             / (max($completedJobs, $totalEndedJobs) + $this->shrinkK);
    }

    /** response_rate prior 0.70 when the provider has no data. */
    public function responseRateOrPrior(?float $responseRate, bool $hasData): float
    {
        return $hasData && $responseRate !== null
            ? $this->clamp01($responseRate)
            : $this->shrinkResponsePrior;
    }

    /**
     * p50 prior — the category median, computed nightly (ComputeTrustScoreJob)
     * and cached as cat:{id}:p50_median. Absence of data is neutral, never
     * fatal or free. Falls back to 60 min before the first nightly run.
     */
    public function categoryP50Prior(?int $categoryId): int
    {
        if ($categoryId === null) {
            return 60;
        }

        return (int) (Cache::get("cat:{$categoryId}:p50_median") ?? 60);
    }

    /** Cache a category's median p50 (called by the nightly job). */
    public function storeCategoryP50Median(int $categoryId, int $medianMins): void
    {
        Cache::put(
            "cat:{$categoryId}:p50_median",
            $medianMins,
            config('ranking.p50_median_ttl_seconds'),
        );
    }

    // ── §1.7 price-fit: a band, not a slope ──────────────────────────────────

    /**
     * p = 1.0 when price ≤ 1.1 × median; linear to 0 at 2.0 × median.
     * Fair pricing is table stakes, gouging is penalized, undercutting buys
     * nothing (lowball listings flag for review instead — isLowballPrice()).
     * Null (quote-priced service or no median yet) → neutral 0.5 via priceTerm().
     */
    public function priceFit(?float $price, ?float $median): ?float
    {
        if ($price === null || $median === null || $median <= 0) {
            return null;
        }

        $ratio = $price / $median;

        if ($ratio <= 1.1) {
            return 1.0;
        }
        if ($ratio >= 2.0) {
            return 0.0;
        }

        return (2.0 - $ratio) / 0.9;
    }

    /** Below 0.5 × median — review-queue material, never a rank boost. */
    public function isLowballPrice(?float $price, ?float $median): bool
    {
        return $price !== null && $median !== null && $median > 0 && $price < 0.5 * $median;
    }

    /**
     * Category(-region) median active price, computed nightly. Region bucket
     * first, category-wide fallback, null before the first nightly run.
     */
    public function categoryPriceMedian(?int $categoryId, ?string $region = null): ?float
    {
        if ($categoryId === null) {
            return null;
        }

        if ($region !== null) {
            $regional = Cache::get("cat:{$categoryId}:region:" . mb_strtolower($region) . ':price_median');
            if ($regional !== null) {
                return (float) $regional;
            }
        }

        $global = Cache::get("cat:{$categoryId}:price_median");

        return $global !== null ? (float) $global : null;
    }

    /** Cache one median (called by the nightly job). Null region = category-wide. */
    public function storeCategoryPriceMedian(int $categoryId, ?string $region, float $median): void
    {
        $key = $region !== null
            ? "cat:{$categoryId}:region:" . mb_strtolower($region) . ':price_median'
            : "cat:{$categoryId}:price_median";

        Cache::put($key, $median, config('ranking.p50_median_ttl_seconds'));
    }

    // ── v3 §7.4 hard filters (gating — applied BEFORE scoring) ───────────────

    /**
     * Pure predicate mirror of the SQL hard filters, used as a post-fetch
     * guard in SearchService and as the unit-testable definition of the gates:
     * tier ≥ 1, trust_score ≥ 0.40, account ACTIVE, denylist clear, and the
     * tier job-cap vs the requested value.
     */
    public function passesHardFilters(
        int    $trustTier,
        float  $trustScore,
        string $accountState,
        bool   $denylisted,
        ?float $requestedValueZmw = null,
    ): bool {
        if ($trustTier < TrustTier::BASIC->value)   return false;
        if ($trustScore < $this->trustScoreFloor)   return false;
        if ($accountState !== 'ACTIVE')             return false;
        if ($denylisted)                            return false;

        if ($requestedValueZmw !== null) {
            $cap = TrustTier::from(min($trustTier, 4))->jobCapZmw();
            if ($cap !== null && $requestedValueZmw > $cap) {
                return false;
            }
        }

        return true;
    }

    public function trustScoreFloor(): float
    {
        return $this->trustScoreFloor;
    }

    // ── §1.8 deterministic fairness slots ────────────────────────────────────

    /**
     * Positions 5, 10, 15, 20 (1-indexed) are reserved for the highest-scoring
     * eligible rows whose provider has < 10 completed jobs. If no eligible row
     * remains for a slot, organic order fills it. Deterministic and
     * reproducible — replaces the v3 §7.3 reshuffle.
     *
     * @param array<int, object> $sorted      Rows sorted by score DESC, each with ->provider_id
     * @param array<string, int> $jobCountMap provider_id => completed jobs
     */
    public function applyFairnessSlots(array $sorted, array $jobCountMap): array
    {
        $sorted = array_values($sorted);
        $n      = count($sorted);
        if ($n === 0) {
            return $sorted;
        }

        $isNew = fn (object $row): bool =>
            ($jobCountMap[$row->provider_id] ?? 0) < $this->newProviderJobs;

        $used    = array_fill(0, $n, false);
        $out     = [];
        $allPtr  = 0;

        // Index queue of new-provider rows in score order.
        $newIdx = [];
        foreach ($sorted as $i => $row) {
            if ($isNew($row)) {
                $newIdx[] = $i;
            }
        }
        $newPtr = 0;

        for ($pos = 1; $pos <= $n; $pos++) {
            $pick = null;

            if (in_array($pos, $this->fairnessSlots, true)) {
                while ($newPtr < count($newIdx) && $used[$newIdx[$newPtr]]) {
                    $newPtr++;
                }
                if ($newPtr < count($newIdx)) {
                    $pick = $newIdx[$newPtr];
                }
            }

            if ($pick === null) {
                while ($allPtr < $n && $used[$allPtr]) {
                    $allPtr++;
                }
                $pick = $allPtr;
            }

            $used[$pick] = true;
            $out[]       = $sorted[$pick];
        }

        return $out;
    }

    // ── v3 §7.5 same-provider diversity (applied AFTER slotting) ─────────────

    /** No more than 2 consecutive results from the same provider. */
    public function applyProviderDiversity(array $results): array
    {
        $out          = [];
        $deferred     = [];
        $consecutives = [];

        foreach (array_values($results) as $row) {
            $pid = $row->provider_id;
            $consecutives[$pid] = ($consecutives[$pid] ?? 0) + 1;

            if ($consecutives[$pid] > $this->maxConsecutive) {
                $deferred[] = $row;
            } else {
                $out[] = $row;
            }

            foreach (array_keys($consecutives) as $other) {
                if ($other !== $pid) {
                    $consecutives[$other] = 0;
                }
            }
        }

        return array_merge($out, $deferred);
    }

    // ── v3.2 §4.2 rating recency decay ───────────────────────────────────────

    /**
     * Exponentially time-weighted mean: each review's weight =
     * 0.5^(age_days / half_life). A provider who had a rough first month can
     * visibly recover; a coasting veteran can't live on old reviews. The
     * decayed value feeds R_bayes and ranking; the all-time average stays on
     * the public profile.
     *
     * @param  array<int, array{rating: float, age_days: float}> $reviews
     */
    public function decayedRatingMean(array $reviews, ?float $halfLifeDays = null): ?float
    {
        if (empty($reviews)) {
            return null;
        }

        $halfLife = $halfLifeDays ?? (float) config('trust.rating_half_life_days', 180);

        $weightedSum = 0.0;
        $weightTotal = 0.0;

        foreach ($reviews as $review) {
            $weight       = pow(0.5, max(0.0, (float) $review['age_days']) / $halfLife);
            $weightedSum += $weight * (float) $review['rating'];
            $weightTotal += $weight;
        }

        return $weightTotal > 0 ? $weightedSum / $weightTotal : null;
    }

    // ── Bayesian rating (v3 §7.1, unchanged) ─────────────────────────────────

    public function computeRBayes(float $rRaw, int $vReviews, float $cMean): float
    {
        $m = $this->minReviews;

        return ($vReviews / ($vReviews + $m)) * $rRaw
             + ($m        / ($vReviews + $m)) * $cMean;
    }

    // ── v3 §5.4 composite trust score (gating metric — NOT a ranking term) ──

    /**
     * Unchanged §5.4 weights; callers must pass cold-start-safe inputs:
     * the SHRUNK completion rate, responseRateOrPrior(), and a categoryP50Prior()
     * p50 when the provider has no data (§4.1).
     */
    public function computeTrustScore(
        int   $trustTier,
        float $rRaw,
        int   $vReviews,
        float $cMean,
        float $completionRateShrunk,
        float $responseRate7d,
        float $cancellationRate30d,
        int   $responseTimeP50Mins,
        int   $completedJobs,
    ): float {
        $tIdentity = $this->verificationStep($trustTier);

        $rBayes   = $this->computeRBayes($rRaw, $vReviews, $cMean);
        $tHistory = $this->normalizeRating($rBayes);

        $tReliability = 0.5 * $completionRateShrunk
                      + 0.3 * $responseRate7d
                      + 0.2 * (1.0 - $cancellationRate30d);

        $tEngagement = $this->responseTerm($responseTimeP50Mins);

        $tTenure = min(1.0, $completedJobs / 50.0);

        $trust = 0.30 * $tIdentity
               + 0.25 * $tHistory
               + 0.20 * $tReliability
               + 0.15 * $tEngagement
               + 0.10 * $tTenure;

        return $this->clamp01($trust);
    }

    // ── Platform mean rating (hourly cache) ──────────────────────────────────

    public function getCMean(): float
    {
        $ttl = config('ranking.c_mean_ttl_seconds', 3600);

        return Cache::remember('ranking:c_mean', $ttl, fn () => $this->recalculateCMean());
    }

    public function invalidateCMean(): void
    {
        Cache::forget('ranking:c_mean');
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function recalculateCMean(): float
    {
        $prior = (float) config('ranking.c_mean_prior');

        try {
            $result = DB::selectOne("
                SELECT COALESCE(SUM(u.r_raw), 0.00) AS rating_sum,
                       COUNT(*)                     AS rated_count
                FROM   users u
                JOIN   provider_profiles pp ON pp.user_id = u.id
                WHERE  pp.trust_tier >= 1
                  AND  u.v_reviews   > 0
            ");

            if (! $result) {
                return $prior;
            }

            // Same k-shrinkage as §4.1: with no rated providers this is exactly
            // the prior; real data takes over as reviews accumulate.
            $n = (int) $result->rated_count;
            $k = $this->shrinkK;

            return ((float) $result->rating_sum + $k * $prior) / ($n + $k);
        } catch (\Throwable $e) {
            Log::error('RankingService::recalculateCMean failed', ['error' => $e->getMessage()]);
            return $prior;
        }
    }

    private function clamp01(float $v): float
    {
        return max(0.0, min(1.0, $v));
    }
}
