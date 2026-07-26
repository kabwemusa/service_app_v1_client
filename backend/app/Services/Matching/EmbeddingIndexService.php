<?php

namespace App\Services\Matching;

use App\Contracts\EmbeddingProvider;
use App\Models\Category;
use App\Models\Service;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Owns the matcher's vector index: builds the embeddable text for each catalog
 * row (name/title + description + synonyms), stores a pre-computed embedding on
 * the row, and answers nearest-neighbour queries by cosine similarity.
 *
 * The catalog is small, so the whole index is loaded into memory (short-cached)
 * and scored in PHP — no pgvector needed. Re-embedding is event-driven
 * (EmbedServiceJob / category writes) and idempotent: a row whose source text is
 * unchanged (same hash) and whose vector matches the active model is skipped.
 */
class EmbeddingIndexService
{
    public function __construct(private readonly EmbeddingProvider $embedder) {}

    // ── Index build / re-embed ────────────────────────────────────────────────

    /** Bulk (re)embed every active category and service. Returns counts. */
    public function syncAll(bool $force = false): array
    {
        $cats = 0;
        foreach (Category::where('is_active', true)->get() as $category) {
            if ($this->syncCategory($category, $force)) {
                $cats++;
            }
        }

        $svcs = 0;
        Service::where('status', 'ACTIVE')->with('category')->chunkById(200, function ($chunk) use (&$svcs, $force) {
            foreach ($chunk as $service) {
                if ($this->syncService($service, $force)) {
                    $svcs++;
                }
            }
        });

        $this->flushCache();

        return ['categories' => $cats, 'services' => $svcs];
    }

    public function syncCategory(Category $category, bool $force = false): bool
    {
        $text = $this->categoryText($category);
        return $this->storeIfChanged('categories', $category->id, $text, $force);
    }

    public function syncService(Service $service, bool $force = false): bool
    {
        $text = $this->serviceText($service);
        return $this->storeIfChanged('services', $service->id, $text, $force);
    }

    private function storeIfChanged(string $table, mixed $id, string $text, bool $force): bool
    {
        $hash  = hash('sha256', $this->embedder->model() . '|' . $text);
        $model = $this->embedder->model();

        if (! $force) {
            $existing = DB::table($table)->where('id', $id)
                ->first(['embedding_source_hash', 'embedding_model']);
            if ($existing && $existing->embedding_source_hash === $hash && $existing->embedding_model === $model) {
                return false; // unchanged — skip the embed call
            }
        }

        $vectors = $this->embedder->embed([$text]);
        if ($vectors === [] || ! isset($vectors[0])) {
            return false; // provider unavailable — leave the old vector in place
        }

        DB::table($table)->where('id', $id)->update([
            'embedding'             => json_encode($vectors[0]),
            'embedding_model'       => $model,
            'embedding_source_hash' => $hash,
            'embedded_at'           => now(),
        ]);

        $this->flushCache();

        return true;
    }

    // ── Query ─────────────────────────────────────────────────────────────────

    /**
     * Nearest catalog items to the query by cosine similarity.
     *
     * @return array<int, array{ref:string,type:string,id:mixed,label:string,subtitle:string,category_id:?int,score:float}>
     */
    public function nearest(string $query, int $k): array
    {
        $index = $this->loadIndex();
        if ($index === []) {
            return [];
        }

        $qv = $this->embedder->embed([$query]);
        if ($qv === [] || ! isset($qv[0])) {
            return [];
        }
        $q = $qv[0];

        $scored = [];
        foreach ($index as $item) {
            $item['score'] = $this->cosine($q, $item['vector']);
            unset($item['vector']);
            $scored[] = $item;
        }

        usort($scored, fn ($a, $b) => $b['score'] <=> $a['score']);

        return array_slice($scored, 0, max(1, $k));
    }

    /**
     * Load all category + service vectors (for the active model only) into memory.
     * Short-cached — invalidated on every re-embed.
     */
    public function loadIndex(): array
    {
        $model = $this->embedder->model();
        $ttl   = (int) config('matching.embeddings.cache_ttl', 600);

        $build = function () use ($model) {
            $items = [];

            $cats = DB::table('categories')
                ->where('is_active', true)
                ->where('embedding_model', $model)
                ->whereNotNull('embedding')
                ->get(['id', 'name', 'embedding']);
            foreach ($cats as $c) {
                $items[] = [
                    'ref'         => 'category:' . $c->id,
                    'type'        => 'category',
                    'id'          => (int) $c->id,
                    'label'       => $c->name,
                    'subtitle'    => 'Category',
                    'category_id' => (int) $c->id,
                    'vector'      => json_decode($c->embedding, true) ?: [],
                ];
            }

            $svcs = DB::table('services as s')
                ->join('categories as cat', 'cat.id', '=', 's.category_id')
                ->where('s.status', 'ACTIVE')
                ->where('s.embedding_model', $model)
                ->whereNotNull('s.embedding')
                ->get(['s.id', 's.title', 's.category_id', 'cat.name as category_name', 's.embedding']);
            foreach ($svcs as $s) {
                $items[] = [
                    'ref'         => 'service:' . $s->id,
                    'type'        => 'service',
                    'id'          => $s->id,
                    'label'       => $s->title,
                    'subtitle'    => $s->category_name,
                    'category_id' => (int) $s->category_id,
                    'vector'      => json_decode($s->embedding, true) ?: [],
                ];
            }

            return $items;
        };

        if ($ttl <= 0) {
            return $build();
        }

        return Cache::remember($this->cacheKey(), $ttl, $build);
    }

    // ── Text builders ──────────────────────────────────────────────────────────

    private function categoryText(Category $category): string
    {
        $syn = is_array($category->synonyms) ? implode(', ', $category->synonyms) : '';
        return trim($category->name . '. ' . $syn);
    }

    private function serviceText(Service $service): string
    {
        $cat = $service->relationLoaded('category')
            ? $service->category?->name
            : Category::find($service->category_id)?->name;

        return trim(implode('. ', array_filter([
            $service->title,
            $service->description,
            $cat,
        ])));
    }

    // ── Math ────────────────────────────────────────────────────────────────────

    /** @param array<int,float> $a @param array<int,float> $b */
    private function cosine(array $a, array $b): float
    {
        $n = min(count($a), count($b));
        if ($n === 0) {
            return 0.0;
        }
        $dot = 0.0; $na = 0.0; $nb = 0.0;
        for ($i = 0; $i < $n; $i++) {
            $dot += $a[$i] * $b[$i];
            $na  += $a[$i] * $a[$i];
            $nb  += $b[$i] * $b[$i];
        }
        if ($na <= 0 || $nb <= 0) {
            return 0.0;
        }
        return $dot / (sqrt($na) * sqrt($nb));
    }

    private function cacheKey(): string
    {
        return 'matching:index:' . $this->embedder->model();
    }

    private function flushCache(): void
    {
        Cache::forget($this->cacheKey());
    }
}
