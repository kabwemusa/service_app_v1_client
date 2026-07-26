<?php

namespace Tests\Feature\Search;

use App\Contracts\EmbeddingProvider;
use App\Contracts\ServiceDisambiguator;
use App\Models\Category;
use App\Services\Matching\EmbeddingIndexService;
use App\Services\Matching\MatchingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Natural-language matcher — the layered pipeline (exact → synonym → semantic →
 * LLM) with the show/clarify/empty confidence gate. Uses deterministic test
 * doubles: a concept-axis embedder (so Layer 2 is repeatable offline) and a
 * scriptable disambiguator (so we can assert Layer 3 is invoked ONLY when needed
 * and that its output is constrained to real candidate IDs).
 */
class ServiceMatchingTest extends TestCase
{
    use RefreshDatabase;

    private int $plumbingId;
    private int $electricalId;
    private int $hairId;

    protected function setUp(): void
    {
        parent::setUp();

        // No result caching in tests (each case rebinds a different disambiguator).
        config(['matching.result_cache_ttl' => 0]);

        $this->plumbingId = Category::create([
            'name' => 'Plumbing', 'slug' => 'plumbing', 'is_active' => true, 'display_order' => 1,
            'synonyms' => ['pipes', 'leaking tap', 'burst pipe', 'geyser', 'water heater', 'toilet', 'drainage'],
        ])->id;

        $this->electricalId = Category::create([
            'name' => 'Electrical', 'slug' => 'electrical', 'is_active' => true, 'display_order' => 2,
            'synonyms' => ['electrician', 'wiring', 'sockets', 'power', 'generator', 'solar'],
        ])->id;

        $this->hairId = Category::create([
            'name' => 'Hair & Beauty', 'slug' => 'hair-beauty', 'is_active' => true, 'display_order' => 3,
            'synonyms' => ['braids', 'plait my hair', 'salon', 'barber', 'nails', 'weave'],
        ])->id;

        Category::create([
            'name' => 'Cleaning', 'slug' => 'cleaning', 'is_active' => true, 'display_order' => 4,
            'synonyms' => ['house cleaning', 'mopping', 'maid service'],
        ]);
    }

    // ── Test doubles ────────────────────────────────────────────────────────────

    /** Deterministic concept-axis embedder — cosine is 1.0 on-axis, 0 off-axis. */
    private function fakeEmbedder(): EmbeddingProvider
    {
        return new class implements EmbeddingProvider {
            private array $axes = ['plumb', 'electr', 'hair', 'clean'];
            private array $map  = [
                'plumb'  => ['plumb', 'geyser', 'leak', 'pipe', 'water', 'boiler', 'burst', 'drain', 'tap', 'toilet'],
                'electr' => ['electr', 'wiring', 'socket', 'power', 'generator', 'solar', 'volt'],
                'hair'   => ['hair', 'braid', 'plait', 'salon', 'barber', 'nail', 'weave', 'clipper'],
                'clean'  => ['clean', 'mop', 'maid', 'scrub', 'housekeep'],
            ];

            public function embed(array $texts): array
            {
                return array_map(function ($t) {
                    $t = mb_strtolower((string) $t);
                    $v = array_fill(0, count($this->axes), 0.0);
                    foreach ($this->axes as $i => $axis) {
                        foreach ($this->map[$axis] as $kw) {
                            if (str_contains($t, $kw)) {
                                $v[$i] += 1.0;
                            }
                        }
                    }
                    return $v;
                }, array_values($texts));
            }

            public function model(): string { return 'fake:test'; }
            public function dimensions(): int { return 4; }
        };
    }

    /** Disambiguator that fails the test if Layer 3 is ever called. */
    private function throwingDisambiguator(): ServiceDisambiguator
    {
        return new class implements ServiceDisambiguator {
            public function select(string $query, array $candidates): array
            {
                throw new \RuntimeException('LLM disambiguation must not run for this query');
            }
        };
    }

    /** Disambiguator that returns a scripted set of refs. */
    private function scriptedDisambiguator(array $refs): ServiceDisambiguator
    {
        return new class($refs) implements ServiceDisambiguator {
            public function __construct(private array $refs) {}
            public function select(string $query, array $candidates): array
            {
                return $this->refs;
            }
        };
    }

    /** Bind doubles, (re)build the vector index, and resolve a fresh matcher. */
    private function matcher(ServiceDisambiguator $disambiguator): MatchingService
    {
        $this->app->instance(EmbeddingProvider::class, $this->fakeEmbedder());
        $this->app->instance(ServiceDisambiguator::class, $disambiguator);

        $this->app->make(EmbeddingIndexService::class)->syncAll(true);

        return $this->app->make(MatchingService::class);
    }

    // ── Layer 1 — exact + synonym skip the LLM ──────────────────────────────────

    public function test_exact_category_match_skips_llm(): void
    {
        $m = $this->matcher($this->throwingDisambiguator())->match('plumbing');

        $this->assertSame('matched', $m['status']);
        $this->assertSame('exact', $m['layer']);
        $this->assertFalse($m['used_llm']);
        $this->assertSame($this->plumbingId, $m['resolved_category_id']);

        // Every submit is logged for tuning (query text only — no PII).
        $this->assertDatabaseHas('match_query_logs', [
            'normalized_query' => 'plumbing',
            'status'           => 'matched',
            'used_llm'         => false,
        ]);
    }

    public function test_synonym_match_skips_llm(): void
    {
        $m = $this->matcher($this->throwingDisambiguator())->match('leaking tap');

        $this->assertSame('matched', $m['status']);
        $this->assertSame('synonym', $m['layer']);
        $this->assertFalse($m['used_llm']);
        $this->assertSame($this->plumbingId, $m['resolved_category_id']);
    }

    // ── Layer 2 — semantics ─────────────────────────────────────────────────────

    public function test_geyser_leaking_maps_to_plumbing(): void
    {
        // The canonical example. Resolves to Plumbing (real category), no fabrication.
        $m = $this->matcher($this->throwingDisambiguator())->match('geyser leaking');

        $this->assertSame('matched', $m['status']);
        $this->assertSame($this->plumbingId, $m['resolved_category_id']);
    }

    public function test_semantic_match_when_no_keyword_overlap(): void
    {
        // "my boiler burst" shares no category name/synonym as a whole phrase, so
        // Layer 1 misses; the semantic layer still resolves it to Plumbing.
        $m = $this->matcher($this->throwingDisambiguator())->match('my boiler burst');

        $this->assertSame('matched', $m['status']);
        $this->assertSame('semantic', $m['layer']);
        $this->assertFalse($m['used_llm']);
        $this->assertSame($this->plumbingId, $m['resolved_category_id']);
    }

    // ── Confidence gate — clarify vs empty ──────────────────────────────────────

    public function test_ambiguous_query_asks_to_clarify(): void
    {
        // "boiler clippers" is a plumbing/hair tie with no Layer-1 hit → Layer 3
        // runs; with the model returning nothing, we ASK rather than guess.
        $m = $this->matcher($this->scriptedDisambiguator([]))->match('boiler clippers');

        $this->assertSame('clarify', $m['status']);
        $this->assertTrue($m['used_llm']);
        $this->assertGreaterThanOrEqual(2, count($m['candidates']));
        $this->assertNull($m['resolved_category_id']);
    }

    public function test_no_match_returns_honest_empty_never_fabricates(): void
    {
        $m = $this->matcher($this->throwingDisambiguator())->match('zxcvb qwerty asdfg');

        $this->assertSame('empty', $m['status']);
        $this->assertNull($m['resolved_category_id']);
        $this->assertSame([], $m['service_ids']); // never invents a service
        $this->assertNotEmpty($m['closest_categories']); // offers real closest categories
    }

    // ── Layer 3 — output constrained to real candidate IDs ──────────────────────

    public function test_llm_output_is_restricted_to_real_ids(): void
    {
        // The model returns one bogus ref + one real ref; the bogus one must be
        // discarded and only the real category resolved.
        $disambiguator = $this->scriptedDisambiguator([
            'category:99999999',                 // not a candidate — must be dropped
            'category:' . $this->plumbingId,     // real
        ]);

        $m = $this->matcher($disambiguator)->match('boiler clippers');

        $this->assertSame('matched', $m['status']);
        $this->assertTrue($m['used_llm']);
        $this->assertSame($this->plumbingId, $m['resolved_category_id']);
    }

    // ── Cross-surface parity ────────────────────────────────────────────────────

    public function test_app_and_whatsapp_produce_identical_matches(): void
    {
        $matcher = $this->matcher($this->throwingDisambiguator());

        $app = $matcher->match('leaking tap', null, 'app');
        $wa  = $matcher->match('leaking tap', null, 'whatsapp');

        $this->assertSame($app['status'], $wa['status']);
        $this->assertSame($app['layer'], $wa['layer']);
        $this->assertSame($app['resolved_category_id'], $wa['resolved_category_id']);
    }

    // ── Type-ahead never triggers the LLM ───────────────────────────────────────

    public function test_typeahead_suggest_makes_no_llm_calls(): void
    {
        // Bind a throwing disambiguator; the suggest endpoint must never touch it.
        $this->app->instance(ServiceDisambiguator::class, $this->throwingDisambiguator());

        $res = $this->getJson('/api/search/suggest?q=plumb');

        $res->assertOk();
        $this->assertNotEmpty($res->json('data.suggestions'));
    }
}
