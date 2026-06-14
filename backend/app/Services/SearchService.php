<?php

namespace App\Services;

use App\Enums\TrustTier;
use App\Jobs\LogSearchImpressionJob;
use App\Services\Ranking\PersonalizationService;
use App\Services\Ranking\PromotedSlotService;
use App\Services\Ranking\RankingService;
use App\Support\Geohash;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Search & Discovery Engine — candidate selection per v3.1 §4.4, scoring per
 * v3.2 §1.3 (OVERRIDE of v3 §7.2).
 *
 * The customer never supplies a radius or coordinates. `lat`/`lng` here are the
 * chosen *delivery location* `L` (device GPS, a saved place, or a place search —
 * resolved client-side to coordinates before this call). A provider `p` is a
 * candidate iff `distance(p.base_location, L) ≤ p.service_radius_km` AND
 * `≤ MAX_SEARCH_RADIUS_KM` — i.e. (provider travel radius) ∩ (system cap).
 *
 * Pipeline:
 *  1. If a keyword is provided → query Typesense for matching service IDs.
 *     If Typesense is unavailable → fall back to PostgreSQL ILIKE.
 *  2. v3 §7.4 hard filters BEFORE scoring: tier ≥ 1, trust_score ≥ 0.40,
 *     account ACTIVE, denylist clear, tier job-cap vs listed price — plus the
 *     §4.4 geography filter and the profile-completeness floor.
 *  3. Retrieve up to `ranking_candidate_limit` candidates with provider metrics.
 *  4. Score each candidate with the v3.2 §1.3 normalized composite
 *     (scoreBreakdown — no promoted boost anywhere).
 *  5. 'recommended' sort = S desc, then §1.8 deterministic fairness slots,
 *     then §7.5 same-provider diversity. Explicit sorts are left untouched.
 *  6. Paginate and return.
 */
class SearchService
{
    public function __construct(
        private readonly RankingService         $ranking,
        private readonly PromotedSlotService    $promoted,
        private readonly PersonalizationService $personalization,
        private readonly TypesenseService       $typesense,
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
        $fallbackQuery = ($query !== '' && $typesenseIds === null) ? $query : null;

        $region = isset($params['region']) ? trim((string) $params['region']) : null;
        $region = $region !== '' ? $region : null;

        $rows = $this->fetchCandidates(
            lat:           $lat,
            lng:           $lng,
            maxRadiusKm:   $maxRadiusKm,
            categoryId:    $categoryId,
            region:        $region,
            serviceIds:    $typesenseIds,
            fallbackQuery: $fallbackQuery,
            limit:         $limit,
            params:        $params,
        );

        Log::info('rowss: ', $rows);
        // §4.4 fallback: no providers cover this delivery location → drop the
        // radius filter and rank nationally by quality signals alone so the
        // feed never shows an empty state solely because of geography.
        $isFallback = false;

        if (empty($rows) && $hasLocation) {
            $rows = $this->fetchCandidates(
                lat:           null,
                lng:           null,
                maxRadiusKm:   $maxRadiusKm,
                categoryId:    $categoryId,
                region:        $region,
                serviceIds:    $typesenseIds,
                fallbackQuery: $fallbackQuery,
                limit:         $limit,
                params:        $params,
            );
            if (!empty($rows)) {
                $isFallback  = true;
                $hasLocation = false; // treat as no-location for scoring & sorting below
            }
        }
        
        if (empty($rows)) {
            return $this->emptyPage($page, $perPage);
        }

        // ── Step 4: collect job counts (cold-start + completion shrinkage) ───
        $providerIds = array_unique(array_column($rows, 'provider_id'));
        $jobCounts   = $this->fetchJobCounts($providerIds);

        // ── Step 5: score each candidate — v3.2 §1.3, no promoted boost ──────
        $cMean = $this->ranking->getCMean();

        // §2 personalization context — same identity the impressions log uses;
        // cached-set lookups happen once per search, not per row.
        $buyerId = isset($params['user_id']) && $params['user_id'] !== null
            ? (string) $params['user_id']
            : null;

        foreach ($rows as $row) {
            $pid           = $row->provider_id;
            $completedJobs = $jobCounts[$pid]['completed'] ?? 0;
            $endedJobs     = $jobCounts[$pid]['ended'] ?? 0;
            $trustTier     = (int) ($row->trust_tier ?? 0);

            // §4.2 — the recency-decayed rating feeds ranking; r_raw is the
            // public all-time average.
            $rBayes = $this->ranking->computeRBayes(
                (float) ($row->r_decayed ?? $row->r_raw),
                (int)   $row->v_reviews,
                $cMean,
            );

            // §4.1 priors: shrunk completion; category-median p50 when no history
            $completionShrunk = $this->ranking->shrunkCompletionRate($completedJobs, $endedJobs);
            $p50Mins          = $completedJobs > 0
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
                distanceKm:       $hasLocation ? (float) ($row->distance_m ?? 0.0) / 1000.0 : null,
                // §1.6 per-category decay constant (categories.proximity_d0_km)
                d0Km:             isset($row->proximity_d0_km) ? (float) $row->proximity_d0_km : null,
                completedJobs:    $completedJobs,
                // §2 — repeat-pair + category-affinity boosts (0 when anonymous)
                bPersonal:        $this->personalization->boostFor($buyerId, $pid, (int) $row->category_id),
                // §1.7 — price-fit band against the nightly category(-region)
                // median; null (quote-priced / no median) stays neutral at 0.5
                priceFit:         $this->ranking->priceFit(
                    $row->base_price !== null ? (float) $row->base_price : null,
                    $this->ranking->categoryPriceMedian((int) $row->category_id, $region),
                ),
            );

            $row->sort_score          = $breakdown['score'];
            $row->score_breakdown     = $breakdown;   // feeds Phase 1 impressions log
            $row->r_bayes             = $rBayes;
            $row->completed_job_count = $completedJobs;
        }

        $completedJobMap = array_map(fn ($c) => $c['completed'], $jobCounts);

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
                    if ($aNull && $bNull) return $b->sort_score <=> $a->sort_score;
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
                    if ($aNull && $bNull) return $b->sort_score <=> $a->sort_score;
                    if ($aNull) return 1;
                    if ($bNull) return -1;
                    return ((float) $a->distance_m <=> (float) $b->distance_m)
                        ?: ($b->sort_score <=> $a->sort_score);
                });
                break;

            default: // 'recommended' — pure composite S desc (proximity is the
                     // d-term inside S, never a pre-sort — v3.2 §1.3/§1.6)
                usort($rows, fn ($a, $b) => $b->sort_score <=> $a->sort_score);
                break;
        }

        // ── Step 6a: §1.8 fairness slots + §7.5 diversity — organic ranking
        // only; explicit sorts (price, distance, …) keep the user's order.
        // Then §1.5: positions 1 and 4 carry promoted inventory (category ×
        // region matched, hard-filtered candidates only — never a score blend).
        if ($sortBy === 'recommended') {
            $rows = $this->ranking->applyFairnessSlots($rows, $completedJobMap);
            $rows = $this->ranking->applyProviderDiversity($rows);
            $rows = $this->promoted->injectPromoted($rows);
        }

        // ── Step 7: paginate ─────────────────────────────────────────────────
        $total     = count($rows);
        $lastPage  = (int) ceil($total / $perPage);
        $offset    = ($page - 1) * $perPage;
        $paginated = array_slice($rows, $offset, $perPage);

        // ── Step 8: §7 impressions log (async — off the hot path) ───────────
        $impressionId = $this->logImpression($paginated, $params, $categoryId, $lat, $lng);

        return [
            'data'          => $paginated,
            'current_page'  => $page,
            'last_page'     => max(1, $lastPage),
            'per_page'      => $perPage,
            'total'         => $total,
            'fallback'      => $isFallback,
            'impression_id' => $impressionId,
        ];
    }

    /**
     * Queue the served page into search_impressions; returns the impression id
     * the client references from result_clicked / booking_started events.
     */
    private function logImpression(array $served, array $params, ?int $categoryId, ?float $lat, ?float $lng): ?string
    {
        if (empty($served)) {
            return null;
        }

        $impressionId = (string) Str::uuid();

        try {
            LogSearchImpressionJob::dispatch(
                impressionId: $impressionId,
                userId:       $params['user_id'] ?? null,
                categoryId:   $categoryId,
                geohash5:     ($lat !== null && $lng !== null) ? Geohash::encode($lat, $lng, 5) : null,
                requestedAt:  now()->toIso8601String(),
                results:      array_map(fn ($row) => [
                    'provider_id' => $row->provider_id,
                    'service_id'  => $row->id,
                    'placement'   => $row->placement ?? 'organic',
                    'score'       => round((float) ($row->sort_score ?? 0), 6),
                    'components'  => $row->score_breakdown ?? [],
                ], $served),
            );
        } catch (\Throwable $e) {
            Log::warning('SearchService::logImpression dispatch failed', ['error' => $e->getMessage()]);
            return null;
        }

        return $impressionId;
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function fetchCandidates(
        ?float  $lat,
        ?float  $lng,
        float   $maxRadiusKm,
        ?int    $categoryId,
        ?string $region,
        ?array  $serviceIds,
        ?string $fallbackQuery,
        int     $limit,
        array   $params = [],
    ): array {
        $minCompleteness = config('search.search.min_profile_completeness');
        $trustFloor      = $this->ranking->trustScoreFloor();
        $hasLocation     = $lat !== null && $lng !== null;

        // v3 §7.4 — tier job-cap vs the listed price (Tier 4 / quote-priced
        // services uncapped). Caps come from the TrustTier enum.
        $capCase = sprintf(
            'CASE pp.trust_tier WHEN 1 THEN %.2F WHEN 2 THEN %.2F WHEN 3 THEN %.2F END',
            TrustTier::BASIC->jobCapZmw(),
            TrustTier::IDENTIFIED->jobCapZmw(),
            TrustTier::VERIFIED->jobCapZmw(),
        );

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

        // v3.2 §1.5 — a promo slot is auctioned per category × region, so it
        // only matches when the search carries a region; without that context
        // every result is organic.
        $promoRegionCond = $region !== null
            ? 'AND ps.region = ?'
            : 'AND 1 = 0';

        $bindings = [];

        if ($region !== null) {
            $bindings[] = $region; // JOIN binding — must precede WHERE bindings
        }

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
                u.r_decayed,
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
                cat.icon  AS cat_icon,
                cat.proximity_d0_km
            FROM services s
            JOIN users            u   ON u.id       = s.provider_id
            JOIN provider_profiles pp ON pp.user_id = s.provider_id
            JOIN categories       cat ON cat.id     = s.category_id
            LEFT JOIN promoted_slots ps
                ON  ps.provider_id = s.provider_id
                AND ps.category_id = s.category_id
                AND ps.status      = 'ACTIVE'
                AND ps.starts_at  <= NOW()
                AND ps.ends_at    >= NOW()
                {$promoRegionCond}
            WHERE s.status              = 'ACTIVE'
              AND cat.is_active         = true
              -- v3 §7.4 hard filters — applied BEFORE scoring
              AND u.account_state       = 'ACTIVE'
              AND pp.trust_tier            >= 1
              AND pp.trust_score           >= ?
              AND pp.profile_completeness >= {$minCompleteness}
              -- tier job-cap vs requested value (listed price)
              AND (s.base_price IS NULL OR pp.trust_tier >= 4 OR s.base_price <= {$capCase})
              -- denylist clear: no approved-or-pending ID doc hash on the fraud denylist
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
              {$locationConds}
        ";

        $bindings[] = $trustFloor;

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
     * Completed and ended (completed + cancelled) job counts per provider —
     * completed feeds B_cold and the fairness slots; both feed the §4.1
     * completion-rate shrinkage.
     *
     * @param  string[]  $providerIds
     * @return array<string, array{completed: int, ended: int}>
     */
    private function fetchJobCounts(array $providerIds): array
    {
        if (empty($providerIds)) {
            return [];
        }

        try {
            // bookings table may not exist yet in early dev; catch gracefully.
            $placeholders = implode(',', array_fill(0, count($providerIds), '?'));

            $rows = DB::select(
                "SELECT provider_id,
                        COUNT(*) FILTER (WHERE status = 'COMPLETED')                  AS completed,
                        COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'CANCELLED')) AS ended
                 FROM   bookings
                 WHERE  provider_id IN ({$placeholders})
                 GROUP  BY provider_id",
                $providerIds,
            );

            $map = [];
            foreach ($rows as $row) {
                $map[$row->provider_id] = [
                    'completed' => (int) $row->completed,
                    'ended'     => (int) $row->ended,
                ];
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
            'fallback'     => false,
        ];
    }
}
