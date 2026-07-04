<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Autocomplete suggestions for the search entry screen.
 *
 * Returns a mixed list of up to MAX_SUGGESTIONS rows (categories first, then
 * services, then providers), plus a resolved_category when the query text
 * matches a category name/slug/synonym exactly — used client-side to show the
 * subcategory refine row.
 *
 * Location is used for proximity-ranked service/provider rows only; the
 * customer never sees or inputs a radius (v3.1 §4.1 hard invariant).
 */
class SearchSuggestService
{
    private const MAX_SUGGESTIONS = 10;
    private const MAX_EACH        = 4;   // max per type (cat/svc/prov)

    public function suggest(string $q, ?float $lat, ?float $lng): array
    {
        $q       = trim($q);
        $likeQ   = '%' . addcslashes($q, '%_\\') . '%';
        $hasLoc  = $lat !== null && $lng !== null;
        $maxKm   = (float) config('search.search.max_radius_km', 20);

        $categories = $this->suggestCategories($q, $likeQ);
        $services   = $this->suggestServices($q, $likeQ, $lat, $lng, $hasLoc, $maxKm);
        $providers  = $this->suggestProviders($q, $likeQ, $lat, $lng, $hasLoc, $maxKm);

        // Interleave: all categories first (max 3), then alternate svc/prov
        $suggestions = [];
        foreach (array_slice($categories, 0, 3) as $c) {
            $suggestions[] = $c;
        }
        $i = 0;
        $svcCount  = count($services);
        $provCount = count($providers);
        while (count($suggestions) < self::MAX_SUGGESTIONS && ($i < $svcCount || $i < $provCount)) {
            if ($i < $svcCount) {
                $suggestions[] = $services[$i];
            }
            if (count($suggestions) < self::MAX_SUGGESTIONS && $i < $provCount) {
                $suggestions[] = $providers[$i];
            }
            $i++;
        }

        return [
            'suggestions'       => array_slice($suggestions, 0, self::MAX_SUGGESTIONS),
            'resolved_category' => $this->resolveCategory($q),
        ];
    }

    // ── Category suggestions ─────────────────────────────────────────────────

    private function suggestCategories(string $q, string $likeQ): array
    {
        $rows = DB::select("
            SELECT id, name, slug, icon, parent_id
            FROM   categories
            WHERE  is_active = true
              AND  (
                  name ILIKE ?
                  OR slug ILIKE ?
                  OR synonyms::text ILIKE ?
              )
            ORDER BY
                CASE WHEN LOWER(name) = LOWER(?) THEN 0 ELSE 1 END,
                display_order,
                name
            LIMIT ?
        ", [$likeQ, $likeQ, $likeQ, $q, self::MAX_EACH]);

        return array_map(fn ($row) => [
            'type'       => 'category',
            'id'         => $row->id,
            'label'      => $row->name,
            'subtitle'   => 'Category',
            'icon'       => $row->icon,
            'parent_id'  => $row->parent_id,
            'match_span' => $this->matchSpan($q, $row->name),
        ], $rows);
    }

    // ── Service suggestions ──────────────────────────────────────────────────

    private function suggestServices(
        string $q,
        string $likeQ,
        ?float $lat,
        ?float $lng,
        bool   $hasLoc,
        float  $maxKm,
    ): array {
        if ($hasLoc) {
            $point         = "ST_GeogFromText('POINT({$lng} {$lat})')";
            $providerPoint = "ST_GeogFromText('POINT(' || pp.base_location_lng || ' ' || pp.base_location_lat || ')')";
            $distanceSel   = "ROUND((ST_Distance({$providerPoint}, {$point}) / 1000)::numeric, 1) AS distance_km,";
            $locFilter     = "AND pp.base_location_lat IS NOT NULL
                              AND ST_DWithin({$providerPoint}, {$point}, LEAST(pp.service_radius_km, ?) * 1000)";
            $bindings      = [$maxKm];
        } else {
            $distanceSel = 'NULL AS distance_km,';
            $locFilter   = '';
            $bindings    = [];
        }

        $bindings = array_merge($bindings, [$likeQ, $likeQ, self::MAX_EACH]);

        $rows = DB::select("
            SELECT
                s.id,
                s.title,
                s.pricing_model,
                s.base_price,
                cat.name AS category_name,
                {$distanceSel}
                pp.trust_tier
            FROM   services s
            JOIN   categories       cat ON cat.id     = s.category_id
            JOIN   users            u   ON u.id       = s.provider_id
            JOIN   provider_profiles pp ON pp.user_id = s.provider_id
            WHERE  s.status          = 'ACTIVE'
              AND  cat.is_active     = true
              AND  u.account_state   = 'ACTIVE'
              AND  pp.trust_tier    >= 1
              {$locFilter}
              AND  (s.title ILIKE ? OR cat.name ILIKE ?)
            ORDER BY pp.trust_tier DESC
            LIMIT  ?
        ", $bindings);

        return array_map(fn ($row) => [
            'type'       => 'service',
            'id'         => $row->id,
            'label'      => $row->title,
            'subtitle'   => $this->servicePriceSubtitle($row->pricing_model, $row->base_price),
            'category'   => $row->category_name,
            'match_span' => $this->matchSpan($q, $row->title),
        ], $rows);
    }

    // ── Provider suggestions ─────────────────────────────────────────────────

    private function suggestProviders(
        string $q,
        string $likeQ,
        ?float $lat,
        ?float $lng,
        bool   $hasLoc,
        float  $maxKm,
    ): array {
        if ($hasLoc) {
            $point         = "ST_GeogFromText('POINT({$lng} {$lat})')";
            $providerPoint = "ST_GeogFromText('POINT(' || pp.base_location_lng || ' ' || pp.base_location_lat || ')')";
            $distanceSel   = "ROUND((ST_Distance({$providerPoint}, {$point}) / 1000)::numeric, 1) AS distance_km,";
            $locFilter     = "AND pp.base_location_lat IS NOT NULL
                              AND ST_DWithin({$providerPoint}, {$point}, LEAST(pp.service_radius_km, ?) * 1000)";
            $bindings      = [$maxKm];
        } else {
            $distanceSel = 'NULL AS distance_km,';
            $locFilter   = '';
            $bindings    = [];
        }

        $bindings = array_merge($bindings, [$likeQ, self::MAX_EACH]);

        $rows = DB::select("
            SELECT
                u.id,
                pp.display_name,
                pp.trust_tier,
                {$distanceSel}
                u.r_raw
            FROM   users            u
            JOIN   provider_profiles pp ON pp.user_id = u.id
            WHERE  u.account_state  = 'ACTIVE'
              AND  pp.trust_tier   >= 1
              {$locFilter}
              AND  pp.display_name ILIKE ?
            ORDER BY pp.trust_tier DESC, u.r_raw DESC
            LIMIT  ?
        ", $bindings);

        return array_map(fn ($row) => [
            'type'       => 'provider',
            'id'         => $row->id,
            'label'      => $row->display_name,
            'subtitle'   => $this->providerSubtitle($row->trust_tier, $row->distance_km ?? null),
            'initials'   => $this->initials($row->display_name),
            'match_span' => $this->matchSpan($q, $row->display_name),
        ], $rows);
    }

    // ── Resolved category ────────────────────────────────────────────────────

    /**
     * Returns the category (with children) when the query is an exact match
     * on name, slug, or any synonym. Null otherwise.
     */
    public function resolveCategory(string $q): ?array
    {
        if ($q === '') {
            return null;
        }

        $row = DB::selectOne("
            SELECT id, name, slug, icon, parent_id
            FROM   categories
            WHERE  is_active = true
              AND  (
                  LOWER(name) = LOWER(?)
                  OR LOWER(slug) = LOWER(?)
                  OR EXISTS (
                      SELECT 1
                      FROM   jsonb_array_elements_text(synonyms::jsonb) AS syn
                      WHERE  LOWER(syn) = LOWER(?)
                  )
              )
            LIMIT 1
        ", [$q, $q, $q]);

        if (! $row) {
            return null;
        }

        $children = DB::select("
            SELECT id, name, slug, icon
            FROM   categories
            WHERE  parent_id = ? AND is_active = true
            ORDER BY display_order, name
        ", [$row->id]);

        return [
            'id'       => $row->id,
            'name'     => $row->name,
            'slug'     => $row->slug,
            'icon'     => $row->icon,
            'children' => array_map(fn ($c) => [
                'id'   => $c->id,
                'name' => $c->name,
                'slug' => $c->slug,
                'icon' => $c->icon,
            ], $children),
        ];
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Returns [start, end] byte offsets of the first case-insensitive match of $q in $label. */
    private function matchSpan(string $q, string $label): ?array
    {
        $pos = stripos($label, $q);
        if ($pos === false) {
            return null;
        }
        return [$pos, $pos + strlen($q)];
    }

    private function servicePriceSubtitle(string $model, mixed $price): string
    {
        // Quote-first models carry no upfront price; HOURLY_CAPPED's base_price
        // is the spend cap — the bounded worst case, never an open meter.
        if (in_array($model, ['PROVIDER_SCOPE', 'QUOTE_DEPOSIT'], true) || $price === null) {
            return 'Quoted after brief';
        }
        $fmt = 'ZMW ' . number_format((float) $price, 0);
        return $model === 'HOURLY_CAPPED' ? "up to {$fmt}" : "from {$fmt}";
    }

    private function providerSubtitle(int $tier, ?float $distanceKm): string
    {
        $label = match(true) {
            $tier >= 4 => 'Professional',
            $tier === 3 => 'Verified',
            $tier === 2 => 'Identified',
            default     => 'Basic',
        };
        if ($distanceKm !== null) {
            $label .= ' · ' . number_format($distanceKm, 1) . ' km';
        }
        return $label;
    }

    private function initials(string $name): string
    {
        $parts = preg_split('/\s+/', trim($name));
        $init  = mb_strtoupper(mb_substr($parts[0], 0, 1));
        if (count($parts) > 1) {
            $init .= mb_strtoupper(mb_substr(end($parts), 0, 1));
        }
        return $init;
    }
}
