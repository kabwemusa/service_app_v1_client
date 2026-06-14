<?php

namespace Tests\Unit\Ranking;

use App\Services\Ranking\RankingService;
use Tests\TestCase;

/**
 * Phase 3 §1.7 — price-fit is a band, not a slope: fair pricing is table
 * stakes, gouging is penalized, undercutting buys nothing.
 */
class PriceFitTest extends TestCase
{
    private RankingService $ranking;

    protected function setUp(): void
    {
        parent::setUp();
        $this->ranking = new RankingService();
    }

    public function test_full_score_within_the_fair_band(): void
    {
        // p = 1.0 when price ≤ 1.1 × median
        $this->assertSame(1.0, $this->ranking->priceFit(100.0, 100.0));
        $this->assertSame(1.0, $this->ranking->priceFit(110.0, 100.0));
        $this->assertSame(1.0, $this->ranking->priceFit(50.0, 100.0));
    }

    public function test_linear_decline_to_zero_at_twice_the_median(): void
    {
        $this->assertEqualsWithDelta(0.5, $this->ranking->priceFit(155.0, 100.0), 0.01); // midpoint of 1.1–2.0
        $this->assertSame(0.0, $this->ranking->priceFit(200.0, 100.0));
        $this->assertSame(0.0, $this->ranking->priceFit(500.0, 100.0));

        // Monotonic between the band edges
        $this->assertGreaterThan(
            $this->ranking->priceFit(180.0, 100.0),
            $this->ranking->priceFit(130.0, 100.0),
        );
    }

    public function test_undercutting_buys_no_extra_rank(): void
    {
        // A lowball price scores exactly the same p as a fair price …
        $this->assertSame(
            $this->ranking->priceFit(100.0, 100.0),
            $this->ranking->priceFit(20.0, 100.0),
        );

        // … but trips the review flag instead
        $this->assertTrue($this->ranking->isLowballPrice(20.0, 100.0));
        $this->assertFalse($this->ranking->isLowballPrice(50.0, 100.0));
        $this->assertFalse($this->ranking->isLowballPrice(90.0, 100.0));
    }

    public function test_no_median_or_quote_priced_is_neutral(): void
    {
        // null propagates → priceTerm() falls back to the 0.5 neutral stub
        $this->assertNull($this->ranking->priceFit(null, 100.0));
        $this->assertNull($this->ranking->priceFit(100.0, null));
        $this->assertNull($this->ranking->priceFit(100.0, 0.0));

        $this->assertSame(0.5, $this->ranking->priceTerm(null));
    }

    public function test_price_fit_flows_into_the_composite_when_enabled(): void
    {
        config(['ranking.price_fit_enabled' => true]);
        $ranking = new RankingService();

        $fair = $ranking->scoreBreakdown(
            rBayes: 4.0, completionShrunk: 0.9, trustTier: 2, p50Mins: 30,
            daysInactive: 1.0, distanceKm: 2.0, d0Km: null, completedJobs: 20,
            priceFit: $ranking->priceFit(100.0, 100.0),
        );
        $gouging = $ranking->scoreBreakdown(
            rBayes: 4.0, completionShrunk: 0.9, trustTier: 2, p50Mins: 30,
            daysInactive: 1.0, distanceKm: 2.0, d0Km: null, completedJobs: 20,
            priceFit: $ranking->priceFit(200.0, 100.0),
        );

        $this->assertSame(1.0, $fair['p']);
        $this->assertSame(0.0, $gouging['p']);
        // Exactly the 0.10 price weight separates them
        $this->assertEqualsWithDelta(0.10, $fair['s_organic'] - $gouging['s_organic'], 1e-9);
    }

    public function test_median_cache_roundtrip_with_region_fallback(): void
    {
        $this->ranking->storeCategoryPriceMedian(5, null, 150.0);
        $this->ranking->storeCategoryPriceMedian(5, 'Lusaka', 180.0);

        // Region bucket wins where present
        $this->assertSame(180.0, $this->ranking->categoryPriceMedian(5, 'Lusaka'));
        // Unknown region falls back to the category-wide median
        $this->assertSame(150.0, $this->ranking->categoryPriceMedian(5, 'Copperbelt'));
        $this->assertSame(150.0, $this->ranking->categoryPriceMedian(5, null));
        // Unknown category → null (neutral)
        $this->assertNull($this->ranking->categoryPriceMedian(999));
    }
}
