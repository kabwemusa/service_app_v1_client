<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Search & Discovery Engine — candidate selection per v3.1 §4.4 (OVERRIDE of v3 §7.2).
 *
 * The customer never supplies a radius or coordinates. `lat`/`lng` here are the
 * chosen *delivery location* `L` (device GPS, a saved place, or a place search —
 * resolved client-side to coordinates before this call). A provider `p` is a
 * candidate iff `distance(p.base_location, L) ≤ p.service_radius_km` AND
 * `≤ MAX_SEARCH_RADIUS_KM` — i.e. (provider travel radius) ∩ (system cap).
 * Proximity in the composite score is then computed against `L` with
 * `R_max = MAX_SEARCH_RADIUS_KM` (never the provider's own radius).
 *
 * Pipeline:
 *  1. If a keyword is provided → query Typesense for matching service IDs.
 *     If Typesense is unavailable → fall back to PostgreSQL ILIKE.
 *  2. Apply the §4.4 candidate filter (provider base location ∩ travel radius ∩ system cap).
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
     *   lat:          float,   // delivery location L — resolved coordinates, never user-typed
     *   lng:          float,
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
        $query       = trim($params['query'] ?? '');
        $lat         = isset($params['lat']) ? (float) $params['lat'] : null;
        $lng         = isset($params['lng']) ? (float) $params['lng'] : null;
        $hasLocation = $lat !== null && $lng !== null;
        // R_max (v3 §16 / v3.1 §4.4) — internal system cap only, never a user input.
        $maxRadiusKm = (float) config('search.search.max_radius_km');
        $categoryId  = isset($params['category_id']) ? (int) $params['category_id'] : null;
        $page        = max(1, (int) ($params['page'] ?? 1));
        $perPage     = config('search.search.max_results');
        $limit       = config('search.search.ranking_candidate_limit');

        // ── Step 1: text filter ──────────────────────────────────────────────
        $typesenseIds = null;

        if ($query !== '') {
            $typesenseIds = $this->typesense->search($query, $categoryId);

            // If Typesense returned an empty hit set (not an error), there are no matches.
            if ($typesenseIds !== null && count($typesenseIds) === 0) {
                return $this->emptyPage($page, $perPage);
            }
        }

        // ── Step 2 & 3: §4.4 candidate filter + provider quality filter ──────
        $rows = $this->fetchCandidates(
            lat:           $lat,
            lng:           $lng,
            maxRadiusKm:   $maxRadiusKm,
            categoryId:    $categoryId,
            serviceIds:    $typesenseIds,    // null = no text filter
            fallbackQuery: ($query !== '' && $typesenseIds === null) ? $query : null,
            limit:         $limit,
            params:        $params,
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
                $row, $completedJobs, $cMean, $maxRadiusKm, $hasLocation
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
                    // D_proximity = 1 − min(1, d_km / R_max).
                    // No location → pass R_max so D_proximity = 0; quality signals rank alone.
                    distanceKm:     $hasLocation
                                        ? (float) ($row->distance_m ?? 0.0) / 1000.0
                                        : $maxRadiusKm,
                    maxRadiusKm:    $maxRadiusKm,
                    hasPromoSlot:   (bool)  ($row->has_promo_slot ?? false),
                    trustTier:      (int)   ($row->trust_tier ?? 0),
                    tResHours:      (float) ($row->response_time_p50_mins ?? 0) / 60.0,
                );
            });

            $row->r_bayes            = $this->ranking->computeRBayes(
                (float) $row->r_raw,
                (int)   $row->v_reviews,
                $cMean,
            );
            $row->completed_job_count = $completedJobs;
        }

        // ── Step 5b: post-score filters ──────────────────────────────────────
        // top_rated: keep only providers whose Bayesian rating ≥ 4.5 (v3.1 §7.1)
        if (!empty($params['top_rated'])) {
            $rows = array_values(array_filter($rows, fn ($r) => ($r->r_bayes ?? 0) >= 4.5));
        }

        if (empty($rows)) {
            return $this->emptyPage($page, $perPage);
        }

        // ── Step 6: sort ─────────────────────────────────────────────────────
        $sortBy = $params['sort'] ?? 'recommended';

        switch ($sortBy) {
            case 'top_rated':
                // Bayesian rating descending
                usort($rows, fn ($a, $b) => ($b->r_bayes ?? 0) <=> ($a->r_bayes ?? 0));
                break;

            case 'price_asc':
                // base_price ascending; QUOTE / null sorts last with stable secondary key
                usort($rows, function ($a, $b) {
                    $aNull = $a->base_price === null;
                    $bNull = $b->base_price === null;
                    if ($aNull && $bNull) return $a->sort_score <=> $b->sort_score;
                    if ($aNull) return 1;
                    if ($bNull) return -1;
                    return (float) $a->base_price <=> (float) $b->base_price;
                });
                break;

            case 'fastest':
                // response_time_p50_mins ascending; null sorts last
                usort($rows, function ($a, $b) {
                    $aNull = $a->response_time_p50_mins === null;
                    $bNull = $b->response_time_p50_mins === null;
                    if ($aNull && $bNull) return $a->sort_score <=> $b->sort_score;
                    if ($aNull) return 1;
                    if ($bNull) return -1;
                    return (int) $a->response_time_p50_mins <=> (int) $b->response_time_p50_mins;
                });
                break;

            case 'nearest':
                // distance_m ascending; null sorts last (no-location browse)
                usort($rows, function ($a, $b) {
                    $aNull = $a->distance_m === null;
                    $bNull = $b->distance_m === null;
                    if ($aNull && $bNull) return $a->sort_score <=> $b->sort_score;
                    if ($aNull) return 1;
                    if ($bNull) return -1;
                    return (float) $a->distance_m <=> (float) $b->distance_m;
                });
                break;

            default: // 'recommended'
                usort($rows, fn ($a, $b) => $b->sort_score <=> $a->sort_score);
                break;
        }

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
        ?float  $lat,
        ?float  $lng,
        float   $maxRadiusKm,
        ?int    $categoryId,
        ?array  $serviceIds,
        ?string $fallbackQuery,
        int     $limit,
        array   $params = [],
    ): array {
        $minCompleteness = config('search.search.min_profile_completeness');
        $hasLocation     = $lat !== null && $lng !== null;

        // When a delivery location is known, compute PostGIS distance and filter
        // by provider travel radius. When unknown (browse feed), skip PostGIS
        // entirely and rank by quality signals instead.
        if ($hasLocation) {
            $point         = "ST_GeogFromText('POINT({$lng} {$lat})')";
            $providerPoint = "ST_GeogFromText('POINT(' || pp.base_location_lng || ' ' || pp.base_location_lat || ')')";
            $distanceCol   = "ST_Distance({$providerPoint}, {$point}) AS distance_m,";
            $locationConds = "AND pp.base_location_lat IS NOT NULL
              AND pp.base_location_lng IS NOT NULL
              -- v3.1 §4.4: distance(p.base_location, L) ≤ p.service_radius_km AND ≤ MAX_SEARCH_RADIUS_KM
              AND ST_DWithin({$providerPoint}, {$point}, LEAST(pp.service_radius_km, ?) * 1000)";
            $orderBy       = 'ORDER BY distance_m ASC';
        } else {
            $distanceCol   = 'NULL AS distance_m,';
            $locationConds = '';
            $orderBy       = 'ORDER BY pp.trust_score DESC, u.r_raw DESC';
        }

        $bindings = [];

        $sql = "
            SELECT
                s.id,
                s.provider_id,
                s.category_id,
                s.title,
                s.description,
                s.base_price,
                s.pricing_model,
                s.status,
                ST_Y(s.service_location::geometry)  AS latitude,
                ST_X(s.service_location::geometry)  AS longitude,
                {$distanceCol}
                u.r_raw,
                u.v_reviews,
                u.completion_rate,
                u.last_active_at,
                pp.profile_completeness,
                pp.display_name,
                pp.trust_score,
                pp.trust_tier,
                pp.service_radius_km,
                pp.response_time_p50_mins,
                pp.response_rate_7d,
                pp.cancellation_rate_30d,
                (ps.provider_id IS NOT NULL)        AS has_promo_slot,
                cat.name  AS category_name,
                cat.id    AS cat_id,
                cat.icon  AS cat_icon
            FROM services s
            JOIN users            u   ON u.id       = s.provider_id
            JOIN provider_profiles pp ON pp.user_id = s.provider_id
            JOIN categories       cat ON cat.id     = s.category_id
            LEFT JOIN promoted_slots ps
                ON  ps.provider_id = s.provider_id
                AND ps.status      = 'ACTIVE'
                AND ps.starts_at  <= NOW()
                AND ps.ends_at    >= NOW()
            WHERE s.status              = 'ACTIVE'
              AND cat.is_active         = true
              AND u.account_state       = 'ACTIVE'
              AND pp.trust_tier            >= 1
              AND pp.profile_completeness >= {$minCompleteness}
              {$locationConds}
        ";

        if ($hasLocation) {
            $bindings[] = $maxRadiusKm;
        }

        if ($categoryId !== null) {
            $sql       .= ' AND s.category_id = ?';
            $bindings[] = $categoryId;
        }

        // Browse filters — v3.1 §6 Filters sheet

        // max_price: include QUOTE/null services regardless of budget (price unknown)
        if (isset($params['max_price']) && $params['max_price'] !== null) {
            $sql       .= ' AND (s.base_price IS NULL OR s.pricing_model = \'QUOTE\' OR s.base_price <= ?)';
            $bindings[] = (float) $params['max_price'];
        }

        // verified_id: trust_tier ≥ 2 (IDENTIFIED — has passed KYC ID check)
        if (!empty($params['verified_id'])) {
            $sql .= ' AND pp.trust_tier >= 2';
        }

        // min_tier: strict tier floor (0 = any, already handled by the global ≥1 gate)
        if (!empty($params['min_tier']) && (int) $params['min_tier'] > 1) {
            $sql       .= ' AND pp.trust_tier >= ?';
            $bindings[] = (int) $params['min_tier'];
        }

        // languages: match any of the requested language codes (v3.1 — en/ny/bem/ton)
        if (!empty($params['languages'])) {
            $langs = array_values(array_filter(array_map('trim', explode(',', $params['languages']))));
            if (!empty($langs)) {
                $placeholders = implode(',', array_fill(0, count($langs), '?'));
                // jsonb_array_elements_text avoids the PDO ? / PostgreSQL ?| operator conflict
                $sql      .= "
                    AND pp.languages IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM   jsonb_array_elements_text(pp.languages::jsonb) AS lang
                        WHERE  lang = ANY(ARRAY[{$placeholders}])
                    )";
                $bindings = array_merge($bindings, $langs);
            }
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

        $sql .= " {$orderBy} LIMIT {$limit}";

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
