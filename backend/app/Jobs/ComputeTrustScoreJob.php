<?php

namespace App\Jobs;

use App\Services\Ranking\RankingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Nightly batch job — recomputes trust_score (§5.4) for every active provider
 * using the v3.2 §4.1 cold-start priors, refreshes the per-category median
 * p50 cache (cat:{id}:p50_median), and flushes the cached c_mean.
 *
 * Cold-start handling: a provider with no history gets the SHRUNK completion
 * rate (0.85 prior), the 0.70 response-rate prior, and their category's median
 * p50 — credible but unproven, so they pass the 0.40 search floor without
 * outranking demonstrated reliability.
 *
 * Schedule in routes/console.php: $schedule->job(new ComputeTrustScoreJob)->dailyAt('02:00');
 */
class ComputeTrustScoreJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 600;
    public int $tries   = 1;

    public function handle(RankingService $ranking): void
    {
        // ── §4.2 rating pipeline: all-time avg (public) + decayed mean (ranking)
        $this->refreshRatings($ranking);

        $ranking->invalidateCMean();
        $cMean = $ranking->getCMean();

        // ── §4.1 p50 priors: per-category median of providers WITH history ───
        $categoryMedians = $this->cacheCategoryP50Medians($ranking);

        // ── §1.7 price-fit inputs: category × region median active prices ────
        $this->cachePriceMedians($ranking);
        $this->flagLowballListings($ranking);

        // ── §6 — request-response performance feeds response_rate_7d ─────────
        $this->refreshResponseRates();

        // Pull all active providers with the metrics needed for §5.4
        $providers = DB::select("
            SELECT
                pp.user_id,
                pp.trust_tier,
                pp.response_rate_7d,
                pp.cancellation_rate_30d,
                pp.response_time_p50_mins,
                u.r_raw,
                u.r_decayed,
                u.v_reviews,
                COUNT(b.id) FILTER (WHERE b.status = 'COMPLETED')                  AS completed_jobs,
                COUNT(b.id) FILTER (WHERE b.status IN ('COMPLETED', 'CANCELLED')) AS ended_jobs,
                (
                    SELECT s.category_id
                    FROM   services s
                    WHERE  s.provider_id = pp.user_id
                      AND  s.status      = 'ACTIVE'
                    GROUP  BY s.category_id
                    ORDER  BY COUNT(*) DESC
                    LIMIT  1
                ) AS primary_category_id
            FROM  provider_profiles pp
            JOIN  users u ON u.id = pp.user_id
            LEFT JOIN bookings b ON b.provider_id = pp.user_id
            WHERE u.account_state = 'ACTIVE'
            GROUP BY pp.user_id, pp.trust_tier, pp.response_rate_7d,
                     pp.cancellation_rate_30d, pp.response_time_p50_mins,
                     u.r_raw, u.r_decayed, u.v_reviews
        ");

        $updated = 0;

        foreach ($providers as $row) {
            try {
                $completedJobs = (int) $row->completed_jobs;
                $endedJobs     = (int) $row->ended_jobs;
                $hasHistory    = $endedJobs > 0;

                // §4.1 shrinkage priors
                $completionShrunk = $ranking->shrunkCompletionRate($completedJobs, $endedJobs);
                $responseRate     = $ranking->responseRateOrPrior(
                    $row->response_rate_7d !== null ? (float) $row->response_rate_7d : null,
                    $hasHistory,
                );
                $p50 = $hasHistory
                    ? (int) ($row->response_time_p50_mins ?? 60)
                    : $ranking->categoryP50Prior(
                        $row->primary_category_id !== null ? (int) $row->primary_category_id : null,
                    );

                $score = $ranking->computeTrustScore(
                    trustTier:             (int)   $row->trust_tier,
                    // §4.2 — the decayed rating feeds trust/ranking
                    rRaw:                  (float) ($row->r_decayed ?? $row->r_raw),
                    vReviews:              (int)   $row->v_reviews,
                    cMean:                 $cMean,
                    completionRateShrunk:  $completionShrunk,
                    responseRate7d:        $responseRate,
                    cancellationRate30d:   (float) ($row->cancellation_rate_30d ?? 0.0),
                    responseTimeP50Mins:   $p50,
                    completedJobs:         $completedJobs,
                );

                DB::table('provider_profiles')
                    ->where('user_id', $row->user_id)
                    ->update(['trust_score' => $score]);

                $updated++;
            } catch (\Throwable $e) {
                Log::warning('ComputeTrustScoreJob: skipped profile', [
                    'user_id' => $row->user_id,
                    'error'   => $e->getMessage(),
                ]);
            }
        }

        Log::info('ComputeTrustScoreJob: done', [
            'updated'          => $updated,
            'category_medians' => count($categoryMedians),
        ]);
    }

    /**
     * v3.2 §6 — response_rate_7d from post-a-request targets: of the requests
     * a provider was notified about in the last 7 days, the share they
     * answered within the 30-minute deadline. Providers with no targets keep
     * their existing value (absence of data is not a downgrade).
     */
    private function refreshResponseRates(): void
    {
        try {
            DB::statement("
                UPDATE provider_profiles pp
                SET    response_rate_7d = sub.rate
                FROM (
                    SELECT t.provider_id,
                           ROUND(
                               COUNT(*) FILTER (WHERE t.responded_at IS NOT NULL AND t.responded_at <= t.respond_by)::numeric
                               / COUNT(*),
                           2) AS rate
                    FROM   service_request_targets t
                    WHERE  t.notified_at >= NOW() - INTERVAL '7 days'
                    GROUP  BY t.provider_id
                ) sub
                WHERE pp.user_id = sub.provider_id
            ");
        } catch (\Throwable $e) {
            Log::warning('ComputeTrustScoreJob: response rates failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * §1.7 — median ACTIVE listing price per category, region-bucketed by the
     * provider's primary region where known, plus a category-wide fallback.
     * Cached for categoryPriceMedian().
     */
    private function cachePriceMedians(RankingService $ranking): void
    {
        try {
            // Category-wide medians (the fallback bucket)
            $global = DB::select("
                SELECT s.category_id,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.base_price) AS median_price
                FROM   services s
                WHERE  s.status = 'ACTIVE' AND s.base_price IS NOT NULL
                GROUP  BY s.category_id
            ");

            foreach ($global as $row) {
                $ranking->storeCategoryPriceMedian((int) $row->category_id, null, (float) $row->median_price);
            }

            // Region buckets — attribution via the provider's primary region
            $regional = DB::select("
                SELECT s.category_id,
                       u.primary_location_region AS region,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.base_price) AS median_price
                FROM   services s
                JOIN   users u ON u.id = s.provider_id
                WHERE  s.status = 'ACTIVE'
                  AND  s.base_price IS NOT NULL
                  AND  u.primary_location_region IS NOT NULL
                GROUP  BY s.category_id, u.primary_location_region
            ");

            foreach ($regional as $row) {
                $ranking->storeCategoryPriceMedian((int) $row->category_id, $row->region, (float) $row->median_price);
            }
        } catch (\Throwable $e) {
            Log::warning('ComputeTrustScoreJob: price medians failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * §1.7 — listings priced below 0.5 × their category median get a review
     * flag (lowballing is a scam vector and circumvention bait), never a rank
     * boost. One open flag per (service, reason); re-detection refreshes it.
     */
    private function flagLowballListings(RankingService $ranking): void
    {
        try {
            $rows = DB::select("
                SELECT s.id, s.provider_id, s.title, s.base_price, s.category_id
                FROM   services s
                WHERE  s.status = 'ACTIVE' AND s.base_price IS NOT NULL
            ");

            $flagged = 0;

            foreach ($rows as $row) {
                $median = $ranking->categoryPriceMedian((int) $row->category_id);

                if (! $ranking->isLowballPrice((float) $row->base_price, $median)) {
                    continue;
                }

                DB::statement("
                    INSERT INTO listing_review_flags (service_id, provider_id, reason, details)
                    VALUES (?, ?, 'LOWBALL_PRICE', ?::jsonb)
                    ON CONFLICT (service_id, reason)
                    DO UPDATE SET details    = EXCLUDED.details,
                                  updated_at = NOW()
                ", [
                    $row->id,
                    $row->provider_id,
                    json_encode([
                        'title'           => $row->title,
                        'price'           => (float) $row->base_price,
                        'category_median' => $median,
                    ]),
                ]);

                $flagged++;
            }

            if ($flagged > 0) {
                Log::info('ComputeTrustScoreJob: lowball listings flagged', ['count' => $flagged]);
            }
        } catch (\Throwable $e) {
            Log::warning('ComputeTrustScoreJob: lowball flagging failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * §4.2 — refresh every reviewed provider's rating triple from the reviews
     * table: r_raw (all-time average, public profile), v_reviews, and
     * r_decayed (recency-weighted mean, weight = 0.5^(age_days/half_life),
     * feeds R_bayes and ranking).
     */
    private function refreshRatings(RankingService $ranking): void
    {
        try {
            $rows = DB::select("
                SELECT reviewee_id,
                       json_agg(json_build_object(
                           'rating',   rating,
                           'age_days', EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0
                       )) AS reviews,
                       AVG(rating) AS all_time_avg,
                       COUNT(*)    AS review_count
                FROM   reviews
                GROUP  BY reviewee_id
            ");
        } catch (\Throwable $e) {
            Log::warning('ComputeTrustScoreJob: rating refresh failed', ['error' => $e->getMessage()]);
            return;
        }

        foreach ($rows as $row) {
            try {
                $reviews = json_decode($row->reviews, true) ?: [];
                $decayed = $ranking->decayedRatingMean($reviews);

                DB::table('users')->where('id', $row->reviewee_id)->update([
                    'r_raw'     => round((float) $row->all_time_avg, 2),
                    'v_reviews' => (int) $row->review_count,
                    'r_decayed' => $decayed !== null ? round($decayed, 2) : null,
                ]);
            } catch (\Throwable $e) {
                Log::warning('ComputeTrustScoreJob: rating refresh skipped user', [
                    'user_id' => $row->reviewee_id,
                    'error'   => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * Median response_time_p50_mins per category, computed from providers that
     * have real history (≥ 1 completed job), cached for categoryP50Prior().
     *
     * @return array<int, int> category_id => median p50 (mins)
     */
    private function cacheCategoryP50Medians(RankingService $ranking): array
    {
        try {
            $rows = DB::select("
                SELECT s.category_id,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pp.response_time_p50_mins) AS median_p50
                FROM   services s
                JOIN   provider_profiles pp ON pp.user_id = s.provider_id
                WHERE  s.status = 'ACTIVE'
                  AND  EXISTS (
                       SELECT 1 FROM bookings b
                       WHERE  b.provider_id = pp.user_id
                         AND  b.status      = 'COMPLETED'
                  )
                GROUP  BY s.category_id
            ");
        } catch (\Throwable $e) {
            Log::warning('ComputeTrustScoreJob: category p50 medians failed', ['error' => $e->getMessage()]);
            return [];
        }

        $medians = [];
        foreach ($rows as $row) {
            $median = (int) round((float) $row->median_p50);
            $ranking->storeCategoryP50Median((int) $row->category_id, $median);
            $medians[(int) $row->category_id] = $median;
        }

        return $medians;
    }
}
