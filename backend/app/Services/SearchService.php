<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Search & Discovery Engine (Phase 3).
 *
 * Pipeline:
 *  1. If a keyword is provided → query Typesense for matching service IDs.
 *     If Typesense is unavailable → fall back to PostgreSQL ILIKE.
 *  2. Apply PostGIS ST_DWithin spatial radius filter.
 *  3. Restrict to VERIFIED providers above the min profile_completeness threshold.
 *  4. Retrieve up to `ranking_candidate_limit` candidates with provider metrics.
 *  5. Compute composite score (RankingService) for each candidate.
 *  6. Sort by score descending, paginate, and return.
 */
class SearchService
{
    public function __construct(
        private readonly RankingService  $ranking,
        private readonly TypesenseService $typesense,
    ) {}

    /**
     * Execute a search and return a paginated + ranked result set.
     *
     * @param  array{
     *   query?:       string,
     *   lat:          float,
     *   lng:          float,
     *   radius_km?:   int,
     *   category_id?: int,
     *   page?:        int,
     * } $params
     *
     * @return array{
     *   data:         array<int, object>,
     *   current_page: int,
     *   last_page:    int,
     *   per_page:     int,
     *   total:        int,
     * }
     */
    public function search(array $params): array
    {
        $query      = trim($params['query']    ?? '');
        $lat        = (float) $params['lat'];
        $lng        = (float) $params['lng'];
        $radiusKm   = min(
            (int) ($params['radius_km'] ?? config('search.search.max_radius_km')),
            config('search.search.max_radius_km'),
        );
        $categoryId = isset($params['category_id']) ? (int) $params['category_id'] : null;
        $page       = max(1, (int) ($params['page'] ?? 1));
        $perPage    = config('search.search.max_results');
        $limit      = config('search.search.ranking_candidate_limit');

        // ── Step 1: text filter ──────────────────────────────────────────────
        $typesenseIds = null;

        if ($query !== '') {
            $typesenseIds = $this->typesense->search($query, $categoryId);

            // If Typesense returned an empty hit set (not an error), there are no matches.
            if ($typesenseIds !== null && count($typesenseIds) === 0) {
                return $this->emptyPage($page, $perPage);
            }
        }

        // ── Step 2 & 3: spatial + provider quality filter ────────────────────
        $rows = $this->fetchCandidates(
            lat:          $lat,
            lng:          $lng,
            radiusMeters: $radiusKm * 1000,
            categoryId:   $categoryId,
            serviceIds:   $typesenseIds,    // null = no text filter
            fallbackQuery:($query !== '' && $typesenseIds === null) ? $query : null,
            limit:        $limit,
        );

        if (empty($rows)) {
            return $this->emptyPage($page, $perPage);
        }

        // ── Step 4: collect completed-job counts for cold-start detection ────
        $providerIds      = array_unique(array_column($rows, 'provider_id'));
        $completedJobMap  = $this->fetchCompletedJobCounts($providerIds);

        // ── Step 5: score each candidate ────────────────────────────────────
        $cMean = $this->ranking->getCMean();

        foreach ($rows as $row) {
            $pid          = $row->provider_id;
            $completedJobs = $completedJobMap[$pid] ?? 0;

            $row->sort_score = $this->ranking->getCachedScore($pid, function () use (
                $row, $completedJobs, $cMean, $radiusKm
            ) {
                return $this->ranking->computeScore(
                    rRaw:           (float) $row->r_raw,
                    vReviews:       (int)   $row->v_reviews,
                    completionRate: (float) $row->completion_rate,
                    lastActiveAt:   $row->last_active_at
                                        ? strtotime($row->last_active_at)
                                        : null,
                    completedJobs:  $completedJobs,
                    cMean:          $cMean,
                    trustScore:     (float) ($row->trust_score ?? 0.0),
                    distanceKm:     (float) ($row->distance_m ?? 0.0) / 1000.0,
                    maxRadiusKm:    (float) $radiusKm,
                    hasPromoSlot:   (bool)  ($row->has_promo_slot ?? false),
                    trustTier:      (int)   ($row->trust_tier ?? 0),
                    tResHours:      (float) ($row->response_time_p50_mins ?? 0) / 60.0,
                );
            });

            $row->r_bayes = $this->ranking->computeRBayes(
                (float) $row->r_raw,
                (int)   $row->v_reviews,
                $cMean,
            );
        }

        // ── Step 6: sort by score desc ───────────────────────────────────────
        usort($rows, fn ($a, $b) => $b->sort_score <=> $a->sort_score);

        // ── Step 6a: fairness floor & provider diversity (§7.3, §7.5) ────────
        $rows = $this->ranking->applyFairnessFloor($rows, $completedJobMap);
        $rows = $this->ranking->applyProviderDiversity($rows);

        // ── Step 7: paginate ─────────────────────────────────────────────────
        $total     = count($rows);
        $lastPage  = (int) ceil($total / $perPage);
        $offset    = ($page - 1) * $perPage;
        $paginated = array_slice($rows, $offset, $perPage);

        return [
            'data'         => $paginated,
            'current_page' => $page,
            'last_page'    => max(1, $lastPage),
            'per_page'     => $perPage,
            'total'        => $total,
        ];
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function fetchCandidates(
        float  $lat,
        float  $lng,
        int    $radiusMeters,
        ?int   $categoryId,
        ?array $serviceIds,
        ?string $fallbackQuery,
        int    $limit,
    ): array {
        $minCompleteness = config('search.search.min_profile_completeness');
        $point           = "ST_GeogFromText('POINT({$lng} {$lat})')";

        $bindings = [];

        $sql = "
            SELECT
                s.id,
                s.provider_id,
                s.category_id,
                s.title,
                s.description,
                s.base_price,
                s.is_active,
                ST_Y(s.service_location::geometry)                          AS latitude,
                ST_X(s.service_location::geometry)                          AS longitude,
                ST_Distance(s.service_location, {$point})                   AS distance_m,
                u.r_raw,
                u.v_reviews,
                u.completion_rate,
                u.last_active_at,
                pp.profile_completeness,
                pp.trust_score,
                pp.trust_tier,
                pp.response_time_p50_mins,
                pp.response_rate_7d,
                pp.cancellation_rate_30d,
                (ps.provider_id IS NOT NULL)                                AS has_promo_slot,
                cat.name  AS category_name,
                cat.id    AS cat_id
            FROM services s
            JOIN users            u   ON u.id        = s.provider_id
            JOIN provider_profiles pp ON pp.user_id  = s.provider_id
            JOIN categories        cat ON cat.id     = s.category_id
            LEFT JOIN promoted_slots ps
                ON  ps.provider_id = s.provider_id
                AND ps.status      = 'ACTIVE'
                AND ps.starts_at  <= NOW()
                AND ps.ends_at    >= NOW()
            WHERE s.is_active          = true
              AND cat.is_active        = true
              AND u.account_state      = 'ACTIVE'
              AND pp.trust_tier        >= 1
              AND pp.trust_score       >= 0.40
              AND pp.profile_completeness >= {$minCompleteness}
              AND ST_DWithin(s.service_location, {$point}, ?)
        ";
        $bindings[] = $radiusMeters;

        if ($categoryId !== null) {
            $sql       .= ' AND s.category_id = ?';
            $bindings[] = $categoryId;
        }

        // Typesense hit IDs → restrict to those service IDs
        if ($serviceIds !== null && count($serviceIds) > 0) {
            $placeholders = implode(',', array_fill(0, count($serviceIds), '?'));
            $sql         .= " AND s.id IN ({$placeholders})";
            $bindings     = array_merge($bindings, $serviceIds);
        }

        // Typesense unavailable + keyword provided → PostgreSQL ILIKE fallback
        if ($fallbackQuery !== null) {
            $sql       .= ' AND (s.title ILIKE ? OR s.description ILIKE ? OR cat.name ILIKE ?)';
            $like       = '%' . addcslashes($fallbackQuery, '%_\\') . '%';
            $bindings[] = $like;
            $bindings[] = $like;
            $bindings[] = $like;
        }

        $sql .= " ORDER BY distance_m ASC LIMIT {$limit}";

        try {
            return DB::select($sql, $bindings);
        } catch (\Throwable $e) {
            Log::error('SearchService::fetchCandidates failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * @param  string[]  $providerIds
     * @return array<string, int>  provideId => completed_job_count
     */
    private function fetchCompletedJobCounts(array $providerIds): array
    {
        if (empty($providerIds)) {
            return [];
        }

        try {
            // bookings table may not exist yet in early dev; catch gracefully.
            $placeholders = implode(',', array_fill(0, count($providerIds), '?'));

            $rows = DB::select(
                "SELECT provider_id, COUNT(*) AS cnt
                 FROM   bookings
                 WHERE  provider_id IN ({$placeholders})
                   AND  status = 'COMPLETED'
                 GROUP  BY provider_id",
                $providerIds,
            );

            $map = [];
            foreach ($rows as $row) {
                $map[$row->provider_id] = (int) $row->cnt;
            }

            return $map;
        } catch (\Throwable) {
            // bookings table doesn't exist yet → everyone is cold-start
            return [];
        }
    }

    private function emptyPage(int $page, int $perPage): array
    {
        return [
            'data'         => [],
            'current_page' => $page,
            'last_page'    => 1,
            'per_page'     => $perPage,
            'total'        => 0,
        ];
    }
}
