<?php

namespace Tests\Unit\Ranking;

use App\Services\Ranking\PersonalizationService;
use App\Services\Ranking\RankingService;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * Phase 2 — §2 personalization boosts and §4.2 rating recency decay.
 */
class PersonalizationAndDecayTest extends TestCase
{
    // ── §2 B_personal ────────────────────────────────────────────────────────

    private function seedBuyerSets(string $buyerId, array $providers, array $categories): void
    {
        Cache::put("buyer:{$buyerId}:repeat_providers", $providers, 3600);
        Cache::put("buyer:{$buyerId}:recent_categories", $categories, 3600);
    }

    public function test_personal_boost_components(): void
    {
        $service = new PersonalizationService();
        $this->seedBuyerSets('buyer-1', ['prov-A'], [7]);

        // Repeat pair only
        $this->assertSame(0.15, $service->boostFor('buyer-1', 'prov-A', 99));
        // Category affinity only
        $this->assertSame(0.03, $service->boostFor('buyer-1', 'prov-B', 7));
        // Both stack
        $this->assertSame(0.18, $service->boostFor('buyer-1', 'prov-A', 7));
        // Neither
        $this->assertSame(0.0, $service->boostFor('buyer-1', 'prov-B', 99));
        // Anonymous buyer → no personalization
        $this->assertSame(0.0, $service->boostFor(null, 'prov-A', 7));
    }

    public function test_invalidate_clears_buyer_sets(): void
    {
        $service = new PersonalizationService();
        $this->seedBuyerSets('buyer-2', ['prov-A'], [7]);

        $service->invalidate('buyer-2');

        $this->assertNull(Cache::get('buyer-2:repeat_providers'));
        $this->assertNull(Cache::get('buyer:buyer-2:repeat_providers'));
        $this->assertNull(Cache::get('buyer:buyer-2:recent_categories'));
    }

    public function test_personal_boost_flows_through_the_composite_score(): void
    {
        $ranking = new RankingService();

        $without = $ranking->scoreBreakdown(
            rBayes: 4.0, completionShrunk: 0.9, trustTier: 2, p50Mins: 30,
            daysInactive: 1.0, distanceKm: 3.0, d0Km: null, completedJobs: 20,
            bPersonal: 0.0,
        );
        $with = $ranking->scoreBreakdown(
            rBayes: 4.0, completionShrunk: 0.9, trustTier: 2, p50Mins: 30,
            daysInactive: 1.0, distanceKm: 3.0, d0Km: null, completedJobs: 20,
            bPersonal: 0.18,
        );

        $this->assertSame(0.18, $with['b_personal']);
        $this->assertEqualsWithDelta(0.18, $with['score'] - $without['score'], 1e-9);
    }

    // ── §4.2 rating recency decay ────────────────────────────────────────────

    public function test_decayed_mean_weights_recent_reviews_more(): void
    {
        $ranking = new RankingService();

        // Provider improving: old 2-star history, recent 5-star work
        $improving = $ranking->decayedRatingMean([
            ['rating' => 2.0, 'age_days' => 720.0],
            ['rating' => 2.0, 'age_days' => 700.0],
            ['rating' => 5.0, 'age_days' => 10.0],
            ['rating' => 5.0, 'age_days' => 5.0],
        ], 180.0);

        // Provider coasting: recent 2-star work on an old 5-star reputation
        $coasting = $ranking->decayedRatingMean([
            ['rating' => 5.0, 'age_days' => 720.0],
            ['rating' => 5.0, 'age_days' => 700.0],
            ['rating' => 2.0, 'age_days' => 10.0],
            ['rating' => 2.0, 'age_days' => 5.0],
        ], 180.0);

        // Flat averages are identical (3.5) — decay must separate them
        $this->assertGreaterThan(4.0, $improving);
        $this->assertLessThan(3.0, $coasting);
        $this->assertGreaterThan($coasting, $improving);
    }

    public function test_decay_half_life_property(): void
    {
        $ranking = new RankingService();

        // One review at exactly one half-life carries half the weight of a
        // fresh one: mean = (1.0·5 + 0.5·1) / 1.5 = 3.6667
        $mean = $ranking->decayedRatingMean([
            ['rating' => 5.0, 'age_days' => 0.0],
            ['rating' => 1.0, 'age_days' => 180.0],
        ], 180.0);

        $this->assertEqualsWithDelta(11.0 / 3.0, $mean, 1e-6);
    }

    public function test_decayed_mean_is_null_without_reviews(): void
    {
        $this->assertNull((new RankingService())->decayedRatingMean([], 180.0));
    }
}
