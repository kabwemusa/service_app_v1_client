<?php

namespace App\Services;

use App\Enums\TrustTier;
use App\Models\Category;
use App\Services\Ranking\RankingService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Backend for the admin Dispatch & Trust Insights module
 * (UI: admin/src/components/insights). Read-only observability — no
 * mutations, so no AuditedMutationService dependency.
 *
 * Every figure here is computed from data that already exists (never
 * invented). Two limits worth being explicit about:
 *   - Cascade/no-provider metrics come from conversation_states.context
 *     (shortlist / shortlist_index — the same JSON RealDispatchService::
 *     cascade() already reads/writes). There's no separate per-dispatch
 *     event log, so history is only as deep as conversation_states retains.
 *   - "Auto vs shortlist split" and "avg accept time" are NOT surfaced:
 *     no column records which dispatch path was used or when a provider
 *     accepted, so those two specific figures from the spec are left out
 *     rather than approximated from nothing.
 *
 * ranking() reuses the EXACT search-ranking algorithm and hard filters from
 * SearchService::fetchCandidates() / RankingService::scoreBreakdown() — same
 * formula customers see, not an approximation. distanceKm is passed null,
 * matching the real "no delivery location" browse path already in
 * production (proximity term = 0), since a category leaderboard has no
 * single customer location. bPersonal is 0 (no buyer context — anonymous).
 */
class AdminInsightsService
{
    public function __construct(private readonly RankingService $ranking) {}

    private const LOW_SCORE_THRESHOLD = 40.0; // composite_score is 0-100

    // ── Dispatch ─────────────────────────────────────────────────────────────────

    public function dispatch(): array
    {
        $convos = DB::table('conversation_states')
            ->where('created_at', '>=', now()->subDays(30))
            ->whereIn('state', ['DISPATCHING', 'FUNDING', 'IN_PROGRESS', 'COMPLETED', 'NO_PROVIDERS', 'EXPIRED'])
            ->get(['id', 'state', 'context', 'booking_id', 'created_at']);

        $withBooking = $convos->filter(fn ($c) => $c->booking_id !== null);
        $noProvider  = $convos->filter(fn ($c) => $c->state === 'NO_PROVIDERS');

        $depths = $withBooking->map(function ($c) {
            $ctx = json_decode($c->context ?? '{}', true);
            return (int) ($ctx['shortlist_index'] ?? 0);
        });

        $distribution = $depths->countBy()->sortKeys();

        return [
            'kpis' => [
                'bookings_dispatched'  => $withBooking->count(),
                'avg_cascade_depth'    => $depths->isNotEmpty() ? round($depths->avg(), 2) : null,
                'no_provider_rate'     => $convos->isNotEmpty() ? round($noProvider->count() / $convos->count(), 3) : null,
            ],
            'cascade_distribution' => $distribution->map(fn ($count, $depth) => [
                'depth' => (int) $depth, 'count' => $count,
            ])->values()->all(),
            'no_provider_events' => $noProvider->sortByDesc('created_at')->take(20)->map(fn ($c) => [
                'id'         => $c->id,
                'time_of_day'=> Carbon::parse($c->created_at)->format('H:i'),
                'created_at' => Carbon::parse($c->created_at)->toIso8601String(),
            ])->values()->all(),
        ];
    }

    // ── Trust ────────────────────────────────────────────────────────────────────

    public function trust(): array
    {
        $signals = DB::table('trust_signals')->get(['provider_id', 'composite_score', 'rating_count', 'last_computed_at']);

        $buckets = array_fill(0, 10, 0); // 0-10, 10-20, ..., 90-100
        foreach ($signals as $s) {
            $score = min(99.99, max(0, (float) $s->composite_score));
            $buckets[(int) floor($score / 10)]++;
        }

        $tierBreakdown = DB::table('provider_profiles')
            ->selectRaw('trust_tier, COUNT(*) as count')
            ->groupBy('trust_tier')
            ->orderBy('trust_tier')
            ->get();

        $minReviews = (int) config('ranking.min_reviews', 5);
        $shrinkageDominated = $signals->filter(fn ($s) => $s->rating_count < $minReviews)->count();

        $lowScore = DB::table('trust_signals as ts')
            ->join('provider_profiles as pp', 'pp.user_id', '=', 'ts.provider_id')
            ->leftJoin('users as u', 'u.id', '=', 'ts.provider_id')
            ->where('ts.composite_score', '<', self::LOW_SCORE_THRESHOLD)
            ->orderBy('ts.composite_score')
            ->limit(20)
            ->get(['ts.provider_id', 'ts.composite_score', 'pp.display_name', 'u.legal_name']);

        $recomputes = DB::table('trust_recompute_logs')
            ->where('created_at', '>=', now()->subDays(30))
            ->orderByDesc('created_at')
            ->limit(50)
            ->get(['provider_id', 'reason', 'old_score', 'new_score', 'created_at']);

        return [
            'score_distribution' => collect($buckets)->map(fn ($count, $i) => [
                'bucket' => "{$i}0-" . ($i + 1) . "0", 'count' => $count,
            ])->values()->all(),
            'tier_breakdown' => $tierBreakdown->map(fn ($r) => ['tier' => (int) $r->trust_tier, 'count' => (int) $r->count])->all(),
            'shrinkage' => [
                'total_providers'        => $signals->count(),
                'shrinkage_dominated'    => $shrinkageDominated,
                'min_reviews_threshold'  => $minReviews,
            ],
            'low_score_providers' => $lowScore->map(fn ($r) => [
                'provider_id' => $r->provider_id,
                'name'        => $r->display_name ?? $r->legal_name ?? 'Provider',
                'score'       => (float) $r->composite_score,
            ])->all(),
            'recompute_events' => $recomputes->map(fn ($r) => [
                'provider_id' => $r->provider_id,
                'reason'      => $r->reason,
                'old_score'   => $r->old_score !== null ? (float) $r->old_score : null,
                'new_score'   => (float) $r->new_score,
                'created_at'  => Carbon::parse($r->created_at)->toIso8601String(),
            ])->all(),
        ];
    }

    // ── Supply ───────────────────────────────────────────────────────────────────

    public function supply(): array
    {
        $probationJobs = (int) config('dispatch.fairness.probation_jobs', 10);

        // % of last-30-days bookings that went to a provider who was (at the
        // time of the query) still under the probation threshold. This is a
        // snapshot approximation, not a historical cohort — rating_count isn't
        // versioned, so we can't know their exact status at dispatch time.
        $recentBookings = DB::table('bookings as b')
            ->leftJoin('trust_signals as ts', 'ts.provider_id', '=', 'b.provider_id')
            ->where('b.created_at', '>=', now()->subDays(30))
            ->select('b.id', DB::raw('COALESCE(ts.rating_count, 0) as rating_count'))
            ->get();

        $toProbation = $recentBookings->filter(fn ($r) => $r->rating_count < $probationJobs)->count();

        $allProviders = DB::table('trust_signals')->count();
        $probationProviders = DB::table('trust_signals')->where('rating_count', '<', $probationJobs)->count();
        $probationWithBooking = DB::table('trust_signals as ts')
            ->whereExists(fn ($q) => $q->select(DB::raw(1))->from('bookings as b')->whereColumn('b.provider_id', 'ts.provider_id'))
            ->where('ts.rating_count', '<', $probationJobs)
            ->count();

        // Supply coverage per category (static provider count, not ring-scoped —
        // ring is computed dynamically per customer location, not a stored
        // provider attribute, so a per-ring count isn't available today).
        $coverage = DB::table('categories as c')
            ->leftJoin('services as s', 's.category_id', '=', 'c.id')
            ->leftJoin('provider_services as ps', function ($j) {
                $j->on('ps.service_id', '=', 's.id')->where('ps.status', 'ACTIVE');
            })
            ->leftJoin('provider_profiles as pp', function ($j) {
                $j->on('pp.user_id', '=', 'ps.provider_id')->where('pp.trust_tier', '>=', 1);
            })
            ->where('c.is_active', true)
            ->groupBy('c.id', 'c.name')
            ->havingRaw('COUNT(DISTINCT pp.user_id) < 3')
            ->orderBy(DB::raw('COUNT(DISTINCT pp.user_id)'))
            ->limit(20)
            ->get(['c.id', 'c.name', DB::raw('COUNT(DISTINCT pp.user_id) as eligible_providers')]);

        // Availability heatmap (day of week × hour) from recurring schedules.
        $availability = DB::table('provider_availability')
            ->where('is_blocked', false)
            ->where('is_recurring', true)
            ->get(['day_of_week', 'start_time', 'end_time']);

        $heatmap = [];
        foreach ($availability as $slot) {
            $startHour = (int) substr($slot->start_time, 0, 2);
            $endHour   = (int) substr($slot->end_time, 0, 2);
            for ($h = $startHour; $h < max($startHour + 1, $endHour); $h++) {
                $key = "{$slot->day_of_week}:{$h}";
                $heatmap[$key] = ($heatmap[$key] ?? 0) + 1;
            }
        }

        return [
            'fairness' => [
                'probation_share_of_recent_bookings' => $recentBookings->isNotEmpty() ? round($toProbation / $recentBookings->count(), 3) : null,
                'probation_activation_rate' => $probationProviders > 0 ? round($probationWithBooking / $probationProviders, 3) : null,
                'graduation_rate' => $allProviders > 0 ? round(($allProviders - $probationProviders) / $allProviders, 3) : null,
                'probation_jobs_threshold' => $probationJobs,
            ],
            'coverage_gaps' => $coverage->map(fn ($r) => [
                'category_id' => $r->id, 'category_name' => $r->name, 'eligible_providers' => (int) $r->eligible_providers,
            ])->all(),
            'availability_heatmap' => collect($heatmap)->map(function ($count, $key) {
                [$day, $hour] = explode(':', $key);
                return ['day_of_week' => (int) $day, 'hour' => (int) $hour, 'count' => $count];
            })->values()->all(),
        ];
    }

    // ── Ranking explainability ────────────────────────────────────────────────

    public function rankingCategories(): array
    {
        // Services can attach to either a top-level or a child category — no
        // parent/leaf filter here, since that varies by what's actually listed.
        return Category::where('is_active', true)
            ->whereExists(fn ($q) => $q->selectRaw(1)->from('services')
                ->whereColumn('services.category_id', 'categories.id')
                ->where('services.status', 'ACTIVE'))
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (Category $c) => ['id' => $c->id, 'name' => $c->name])
            ->all();
    }

    /**
     * Full ranked leaderboard for one category — same hard filters and
     * scoring formula SearchService uses for a no-location browse. #1 in the
     * returned list is exactly who would show first for a customer browsing
     * this category with no delivery location set.
     */
    public function ranking(int $categoryId): array
    {
        $minCompleteness = config('search.search.min_profile_completeness');
        $trustFloor       = $this->ranking->trustScoreFloor();

        $capCase = sprintf(
            'CASE pp.trust_tier WHEN 1 THEN %.2F WHEN 2 THEN %.2F WHEN 3 THEN %.2F END',
            TrustTier::BASIC->jobCapZmw(),
            TrustTier::IDENTIFIED->jobCapZmw(),
            TrustTier::VERIFIED->jobCapZmw(),
        );

        // Same hard filters as SearchService::fetchCandidates() (v3 §7.4),
        // minus geo/typesense/promoted-slot machinery that only matters for a
        // live customer request, not a category-wide leaderboard.
        $rows = DB::select("
            SELECT
                s.id, s.provider_id, s.category_id, s.title, s.base_price,
                u.r_raw, u.r_decayed, u.v_reviews, u.last_active_at,
                pp.display_name, pp.trust_tier, pp.response_time_p50_mins,
                cat.name AS category_name, cat.proximity_d0_km
            FROM services s
            JOIN users             u   ON u.id       = s.provider_id
            JOIN provider_profiles pp  ON pp.user_id = s.provider_id
            JOIN categories        cat ON cat.id     = s.category_id
            WHERE s.status              = 'ACTIVE'
              AND cat.is_active         = true
              AND s.category_id         = ?
              AND u.account_state       = 'ACTIVE'
              AND pp.trust_tier            >= 1
              AND pp.trust_score           >= ?
              AND pp.profile_completeness >= {$minCompleteness}
              AND (s.base_price IS NULL OR pp.trust_tier >= 4 OR s.base_price <= {$capCase})
              AND NOT EXISTS (
                  SELECT 1
                  FROM   identity_documents idoc
                  JOIN   fraud_denylist fd
                    ON   fd.hash_value = idoc.doc_number_hash
                   AND   fd.hash_type IN ('NRC_HASH', 'PASSPORT_HASH')
                  WHERE  idoc.user_id = u.id
                    AND  idoc.doc_number_hash IS NOT NULL
                    AND  (fd.expires_at IS NULL OR fd.expires_at > NOW())
              )
        ", [$categoryId, $trustFloor]);

        if (empty($rows)) {
            return ['category_id' => $categoryId, 'providers' => []];
        }

        $providerIds = array_unique(array_column($rows, 'provider_id'));
        $jobCounts   = $this->fetchJobCounts($providerIds);
        $cMean       = $this->ranking->getCMean();

        $results = [];
        foreach ($rows as $row) {
            $pid           = $row->provider_id;
            $completedJobs = $jobCounts[$pid]['completed'] ?? 0;
            $endedJobs     = $jobCounts[$pid]['ended'] ?? 0;
            $trustTier     = (int) ($row->trust_tier ?? 0);

            $rBayes = $this->ranking->computeRBayes(
                (float) ($row->r_decayed ?? $row->r_raw),
                (int) $row->v_reviews,
                $cMean,
            );
            $completionShrunk = $this->ranking->shrunkCompletionRate($completedJobs, $endedJobs);
            $p50Mins = $completedJobs > 0
                ? (int) ($row->response_time_p50_mins ?? 60)
                : $this->ranking->categoryP50Prior((int) $row->category_id);
            $daysInactive = $row->last_active_at
                ? max(0, time() - strtotime($row->last_active_at)) / 86400.0
                : 30.0;

            $breakdown = $this->ranking->scoreBreakdown(
                rBayes:           $rBayes,
                completionShrunk: $completionShrunk,
                trustTier:        $trustTier,
                p50Mins:          $p50Mins,
                daysInactive:     $daysInactive,
                distanceKm:       null, // no single customer location for a category-wide view
                d0Km:             isset($row->proximity_d0_km) ? (float) $row->proximity_d0_km : null,
                completedJobs:    $completedJobs,
                bPersonal:        0.0, // anonymous — no buyer context to personalize for
                priceFit:         $this->ranking->priceFit(
                    $row->base_price !== null ? (float) $row->base_price : null,
                    $this->ranking->categoryPriceMedian((int) $row->category_id),
                ),
            );

            $results[] = [
                'service_id'     => $row->id,
                'provider_id'    => $pid,
                'provider_name'  => $row->display_name ?? 'Provider',
                'service_title'  => $row->title,
                'trust_tier'     => $trustTier,
                'r_bayes'        => round($rBayes, 2),
                'completed_jobs' => $completedJobs,
                'breakdown'      => $breakdown,
            ];
        }

        usort($results, fn ($a, $b) => $b['breakdown']['score'] <=> $a['breakdown']['score']);
        foreach ($results as $i => &$r) {
            $r['rank'] = $i + 1;
        }
        unset($r);

        return [
            'category_id' => $categoryId,
            'note'        => 'Sorted by the same organic score customers see when browsing this category with no delivery location set. A specific customer\'s distance to each provider shifts this order slightly at search time.',
            'providers'   => $results,
        ];
    }

    private function fetchJobCounts(array $providerIds): array
    {
        if (empty($providerIds)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($providerIds), '?'));
        $rows = DB::select("
            SELECT provider_id,
                   COUNT(*) FILTER (WHERE status = 'COMPLETED')                  AS completed,
                   COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'CANCELLED')) AS ended
            FROM   bookings
            WHERE  provider_id IN ({$placeholders})
            GROUP  BY provider_id
        ", $providerIds);

        $map = [];
        foreach ($rows as $r) {
            $map[$r->provider_id] = ['completed' => (int) $r->completed, 'ended' => (int) $r->ended];
        }
        return $map;
    }
}
