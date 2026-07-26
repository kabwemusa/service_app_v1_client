<?php

namespace App\Services\Matching;

use App\Contracts\ServiceDisambiguator;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * matchServices(query) → real catalog matches, channel-agnostic. Both the app
 * home and WhatsApp intake call THIS (one implementation, identical results).
 *
 * Layered pipeline (cheap → expensive), per the spec:
 *   1. EXACT + SYNONYM   — normalised equality/containment/typo-tolerant match
 *                          against category name/slug/synonyms and service titles.
 *   2. SEMANTIC          — embedding cosine nearest over categories + services.
 *   3. LLM DISAMBIGUATION— ONLY when 1–2 are low-confidence or tied; the model
 *                          SELECTS from the real candidate set (validated IDs).
 * Confidence gate → matched (show) | clarify (ask with 2–3 real options) | empty
 * (honest "we don't have that yet" + closest categories). The matcher only ever
 * returns real catalog IDs; it never fabricates a service.
 *
 * It resolves WHAT (category / specific services); the caller hands that to the
 * ranking engine (SearchService) which decides WHO. Ordering is never by a trust
 * number here.
 */
class MatchingService
{
    public function __construct(
        private readonly EmbeddingIndexService $index,
        private readonly ServiceDisambiguator  $disambiguator,
    ) {}

    /**
     * @return array{
     *   status: 'matched'|'clarify'|'empty',
     *   layer: ?string,
     *   confidence: float,
     *   used_llm: bool,
     *   resolved_category_id: ?int,
     *   service_ids: string[],
     *   candidates: array<int, array{ref:string,type:string,id:mixed,label:string,subtitle:string,category_id:?int}>,
     *   closest_categories: array<int, array{id:int,name:string}>,
     *   query: string,
     *   log_id: ?string,
     * }
     */
    public function match(string $query, ?string $userId = null, string $channel = 'app'): array
    {
        $raw        = trim($query);
        $normalized = $this->normalize($raw);

        if ($normalized === '') {
            return $this->finish($raw, $normalized, $this->emptyResult($normalized), $userId, $channel);
        }

        // Frequent-query result cache — WHAT only (location affects WHO, not this).
        $ttl      = (int) config('matching.result_cache_ttl', 300);
        $cacheKey = 'matching:result:' . md5($normalized);
        $compute  = fn () => $this->run($raw, $normalized);

        $result = $ttl > 0 ? Cache::remember($cacheKey, $ttl, $compute) : $compute();

        return $this->finish($raw, $normalized, $result, $userId, $channel);
    }

    /** The pipeline itself (cacheable — no per-user/location state). */
    private function run(string $raw, string $normalized): array
    {
        // ── Layer 1: exact + synonym (+ typo) ────────────────────────────────
        $exact = $this->layerExact($normalized);
        if ($exact !== null) {
            return $this->matched(
                layer: $exact['layer'],
                refs: [$exact['ref']],
                confidence: $exact['score'],
                usedLlm: false,
                candidates: [$exact],
            );
        }

        // ── Layer 2: semantic ────────────────────────────────────────────────
        $candidates = [];
        if (config('matching.layers.semantic', true)) {
            $candidates = $this->index->nearest($normalized, (int) config('matching.top_k', 5));
        }

        $show    = (float) config('matching.thresholds.show', 0.62);
        $clarify = (float) config('matching.thresholds.clarify', 0.40);
        $tie     = (float) config('matching.thresholds.tie_margin', 0.05);

        $top       = $candidates[0] ?? null;
        $topScore  = $top['score'] ?? 0.0;
        $second    = $candidates[1]['score'] ?? 0.0;
        $ambiguous = $top !== null && ($topScore - $second) < $tie && $second > 0;

        // Confident + unambiguous → show (no LLM).
        if ($top !== null && $topScore >= $show && ! $ambiguous) {
            return $this->matched('semantic', [$top['ref']], $topScore, false, $candidates);
        }

        // ── Layer 3: LLM — only when there is signal but it's low/tied ────────
        $usedLlm = false;
        if ($top !== null && $topScore >= $clarify && config('matching.layers.llm', true)) {
            $usedLlm = true;
            $slim    = array_map(fn ($c) => [
                'ref' => $c['ref'], 'label' => $c['label'], 'subtitle' => $c['subtitle'],
            ], $candidates);

            $chosen = $this->disambiguator->select($raw, $slim);
            // Validate: keep only refs that were genuinely offered (never invent).
            $offered = array_column($candidates, 'ref');
            $chosen  = array_values(array_intersect($chosen, $offered));

            if ($chosen !== []) {
                return $this->matched('llm', $chosen, max($topScore, $show), true, $candidates);
            }
        }

        // ── Confidence gate: clarify vs honest-empty ─────────────────────────
        if ($top !== null && $topScore >= $clarify) {
            $opts = array_slice($candidates, 0, (int) config('matching.clarify_options', 3));
            return [
                'status'               => 'clarify',
                'layer'                => $usedLlm ? 'llm' : 'semantic',
                'confidence'           => $topScore,
                'used_llm'             => $usedLlm,
                'resolved_category_id' => null,
                'service_ids'          => [],
                'candidates'           => $this->publicCandidates($opts),
                'closest_categories'   => $this->closestCategories($candidates),
            ];
        }

        return $this->emptyResult($normalized, $candidates);
    }

    // ── Layer 1 implementation ─────────────────────────────────────────────────

    /**
     * Exact / synonym / containment / typo match against categories (name, slug,
     * synonyms) and — for a strong hit — service titles. Returns the single best
     * hit as a candidate array (with `layer` and `score`), or null.
     */
    private function layerExact(string $q): ?array
    {
        $fuzzy = (float) config('matching.thresholds.fuzzy', 0.55);
        $best  = null;

        $cats = DB::table('categories')
            ->where('is_active', true)
            ->get(['id', 'name', 'slug', 'synonyms']);

        foreach ($cats as $cat) {
            $phrases = [['t' => mb_strtolower($cat->name), 'kind' => 'exact']];
            $phrases[] = ['t' => str_replace('-', ' ', mb_strtolower($cat->slug)), 'kind' => 'exact'];
            foreach ((json_decode($cat->synonyms ?? '[]', true) ?: []) as $syn) {
                $phrases[] = ['t' => mb_strtolower((string) $syn), 'kind' => 'synonym'];
            }

            foreach ($phrases as $p) {
                $t = trim($p['t']);
                if ($t === '') {
                    continue;
                }

                if ($q === $t) {
                    $score = 1.0;
                    $layer = $p['kind'];
                } elseif (mb_strlen($t) >= 4 && $this->containsWholePhrase($q, $t)) {
                    $score = 0.95;
                    $layer = 'synonym';
                } else {
                    $score = $this->similarity($q, $t);
                    if ($score < $fuzzy) {
                        continue;
                    }
                    $layer = 'synonym';
                }

                if ($best === null || $score > $best['score']) {
                    $best = [
                        'ref'         => 'category:' . $cat->id,
                        'type'        => 'category',
                        'id'          => (int) $cat->id,
                        'label'       => $cat->name,
                        'subtitle'    => 'Category',
                        'category_id' => (int) $cat->id,
                        'layer'       => $layer,
                        'score'       => $score,
                    ];
                }
            }
        }

        // Exact service title match (strong, specific hit).
        $svc = DB::table('services as s')
            ->join('categories as cat', 'cat.id', '=', 's.category_id')
            ->where('s.status', 'ACTIVE')
            ->whereRaw('LOWER(s.title) = ?', [$q])
            ->first(['s.id', 's.title', 's.category_id', 'cat.name as category_name']);

        if ($svc) {
            return [
                'ref'         => 'service:' . $svc->id,
                'type'        => 'service',
                'id'          => $svc->id,
                'label'       => $svc->title,
                'subtitle'    => $svc->category_name,
                'category_id' => (int) $svc->category_id,
                'layer'       => 'exact',
                'score'       => 1.0,
            ];
        }

        // Only accept a category hit that is an exact/containment match or clears
        // the fuzzy bar (already filtered above).
        return $best;
    }

    /** True when $needle appears in $haystack on word boundaries. */
    private function containsWholePhrase(string $haystack, string $needle): bool
    {
        return (bool) preg_match('/\b' . preg_quote($needle, '/') . '\b/u', $haystack);
    }

    /** Normalised string similarity in [0,1] (Levenshtein-based, cheap, no extension). */
    private function similarity(string $a, string $b): float
    {
        $max = max(mb_strlen($a), mb_strlen($b));
        if ($max === 0) {
            return 0.0;
        }
        // levenshtein() is byte-based and caps at 255 chars — fine for short queries.
        if (strlen($a) > 255 || strlen($b) > 255) {
            similar_text($a, $b, $pct);
            return $pct / 100;
        }
        return 1 - (levenshtein($a, $b) / $max);
    }

    // ── Result assembly ─────────────────────────────────────────────────────────

    /**
     * Build a matched result from chosen refs. Category refs set
     * resolved_category_id (ranking browses the category); service refs restrict
     * to those real service IDs (and carry their category for ranking context).
     */
    private function matched(string $layer, array $refs, float $confidence, bool $usedLlm, array $candidates): array
    {
        $byRef       = [];
        foreach ($candidates as $c) {
            $byRef[$c['ref']] = $c;
        }

        $categoryId  = null;
        $serviceIds  = [];
        foreach ($refs as $ref) {
            $c = $byRef[$ref] ?? $this->hydrateRef($ref);
            if ($c === null) {
                continue;
            }
            if ($c['type'] === 'category') {
                $categoryId ??= $c['category_id'];
            } else {
                $serviceIds[] = (string) $c['id'];
                $categoryId ??= $c['category_id'];
            }
        }

        return [
            'status'               => 'matched',
            'layer'                => $layer,
            'confidence'           => round($confidence, 4),
            'used_llm'             => $usedLlm,
            'resolved_category_id' => $categoryId,
            'service_ids'          => $serviceIds,
            'candidates'           => [],
            'closest_categories'   => [],
        ];
    }

    /** Resolve a ref we didn't already carry (defensive). */
    private function hydrateRef(string $ref): ?array
    {
        [$type, $id] = array_pad(explode(':', $ref, 2), 2, null);
        if ($type === 'category' && $id !== null) {
            $c = DB::table('categories')->where('id', (int) $id)->first(['id', 'name']);
            return $c ? ['type' => 'category', 'id' => (int) $c->id, 'category_id' => (int) $c->id, 'label' => $c->name, 'subtitle' => 'Category', 'ref' => $ref] : null;
        }
        if ($type === 'service' && $id !== null) {
            $s = DB::table('services')->where('id', $id)->first(['id', 'title', 'category_id']);
            return $s ? ['type' => 'service', 'id' => $s->id, 'category_id' => (int) $s->category_id, 'label' => $s->title, 'subtitle' => '', 'ref' => $ref] : null;
        }
        return null;
    }

    private function publicCandidates(array $candidates): array
    {
        return array_map(fn ($c) => [
            'ref'         => $c['ref'],
            'type'        => $c['type'],
            'id'          => $c['id'],
            'label'       => $c['label'],
            'subtitle'    => $c['subtitle'],
            'category_id' => $c['category_id'] ?? null,
        ], $candidates);
    }

    /** Closest real categories for the honest empty / clarify context. */
    private function closestCategories(array $candidates): array
    {
        $out = [];
        foreach ($candidates as $c) {
            if ($c['type'] === 'category' && $c['category_id'] !== null) {
                $out[$c['category_id']] = ['id' => $c['category_id'], 'name' => $c['label']];
            } elseif ($c['category_id'] !== null) {
                $name = DB::table('categories')->where('id', $c['category_id'])->value('name');
                if ($name) {
                    $out[$c['category_id']] = ['id' => $c['category_id'], 'name' => $name];
                }
            }
            if (count($out) >= 3) {
                break;
            }
        }

        if ($out === []) {
            // Fall back to popular categories so the empty state is never bare.
            $rows = DB::table('categories')->where('is_active', true)
                ->orderBy('display_order')->limit(3)->get(['id', 'name']);
            foreach ($rows as $r) {
                $out[$r->id] = ['id' => (int) $r->id, 'name' => $r->name];
            }
        }

        return array_values($out);
    }

    private function emptyResult(string $normalized, array $candidates = []): array
    {
        return [
            'status'               => 'empty',
            'layer'                => 'none',
            'confidence'           => $candidates[0]['score'] ?? 0.0,
            'used_llm'             => false,
            'resolved_category_id' => null,
            'service_ids'          => [],
            'candidates'           => [],
            'closest_categories'   => $this->closestCategories($candidates),
        ];
    }

    // ── Normalisation + logging ──────────────────────────────────────────────────

    private function normalize(string $q): string
    {
        $q = mb_strtolower(trim($q));
        $q = preg_replace('/\s+/', ' ', $q) ?? $q;
        return mb_substr($q, 0, (int) config('matching.max_query_length', 160));
    }

    /**
     * Attach the tuning log (query text only — no PII) and return the result with
     * a log_id the caller can reference when recording booked/refined outcomes.
     */
    private function finish(string $raw, string $normalized, array $result, ?string $userId, string $channel): array
    {
        $result['query']  = $normalized;
        $result['log_id'] = null;

        if (! config('matching.enabled', true)) {
            return $result;
        }

        try {
            $id = (string) Str::uuid();
            DB::table('match_query_logs')->insert([
                'id'                   => $id,
                'query'                => mb_substr($raw, 0, 500),
                'normalized_query'     => $normalized,
                'resolved_layer'       => $result['layer'],
                'status'               => $result['status'],
                'resolved_category_id' => $result['resolved_category_id'],
                'service_ids'          => json_encode($result['service_ids']),
                'confidence'           => $result['confidence'],
                'used_llm'             => $result['used_llm'],
                'channel'              => $channel,
                'user_id'              => $userId,
                'created_at'           => now(),
                'updated_at'           => now(),
            ]);
            $result['log_id'] = $id;
        } catch (\Throwable $e) {
            Log::warning('MatchingService: log insert failed', ['error' => $e->getMessage()]);
        }

        return $result;
    }

    /** Record what the customer did after a match (tuning dataset; no PII). */
    public function recordOutcome(string $logId, string $outcome, ?string $bookedServiceId = null): void
    {
        try {
            DB::table('match_query_logs')->where('id', $logId)->update([
                'outcome'           => $outcome,
                'booked_service_id' => $bookedServiceId,
                'updated_at'        => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('MatchingService: outcome update failed', ['error' => $e->getMessage()]);
        }
    }
}
