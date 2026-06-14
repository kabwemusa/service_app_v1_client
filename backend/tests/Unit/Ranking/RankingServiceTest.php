<?php

namespace Tests\Unit\Ranking;

use App\Services\Ranking\RankingService;
use Tests\TestCase;

/**
 * Phase 0 required tests (v3.2 remediation §0.5):
 *  - score monotonicity
 *  - S_organic boundedness
 *  - the "v3 +2.0 cold-start bug" regression test
 *  - deterministic fairness slots, diversity, hard filters (isolated)
 *  - §0.3 cold-start prior regressions
 */
class RankingServiceTest extends TestCase
{
    private RankingService $ranking;

    protected function setUp(): void
    {
        parent::setUp();
        $this->ranking = new RankingService();
    }

    /** Baseline mid-range provider for perturbation tests. */
    private function baseline(): array
    {
        return [
            'rBayes'           => 3.5,
            'completionShrunk' => 0.70,
            'trustTier'        => 2,
            'p50Mins'          => 60,
            'daysInactive'     => 10.0,
            'distanceKm'       => 6.0,
            'd0Km'             => null,
            'completedJobs'    => 20,
            'bPersonal'        => 0.0,
            'priceFit'         => null,
        ];
    }

    private function score(array $overrides = []): float
    {
        return $this->ranking->scoreBreakdown(...array_merge($this->baseline(), $overrides))['score'];
    }

    // ── 0.5 Score monotonicity ───────────────────────────────────────────────

    public function test_improving_any_single_feature_never_lowers_s(): void
    {
        $base = $this->score();

        $improvements = [
            'rating better'      => ['rBayes' => 4.8],
            'completion better'  => ['completionShrunk' => 0.95],
            'tier 2 → 3'         => ['trustTier' => 3],
            'tier 3 → 4'         => ['trustTier' => 4],
            'faster response'    => ['p50Mins' => 8],
            'more recent'        => ['daysInactive' => 0.5],
            'closer'             => ['distanceKm' => 1.0],
        ];

        foreach ($improvements as $label => $override) {
            $this->assertGreaterThanOrEqual(
                $base,
                $this->score($override),
                "Improving '{$label}' lowered the score",
            );
        }

        // And from the Tier-1 floor upward (Tier 1 carries the ×0.85 multiplier)
        $tier1 = $this->score(['trustTier' => 1]);
        $tier2 = $this->score(['trustTier' => 2]);
        $this->assertGreaterThan($tier1, $tier2, 'Tier 1 → 2 must always raise S');
    }

    // ── 0.5 Boundedness ──────────────────────────────────────────────────────

    public function test_s_organic_is_bounded_in_unit_interval_for_all_valid_inputs(): void
    {
        foreach ([1.0, 3.0, 5.0] as $rBayes) {
            foreach ([0.0, 0.5, 1.0] as $completion) {
                foreach ([1, 2, 3, 4] as $tier) {
                    foreach ([0, 30, 1440] as $p50) {
                        foreach ([0.0, 30.0, 365.0] as $inactive) {
                            foreach ([null, 0.0, 2.0, 50.0] as $distance) {
                                $b = $this->ranking->scoreBreakdown(
                                    rBayes:           $rBayes,
                                    completionShrunk: $completion,
                                    trustTier:        $tier,
                                    p50Mins:          $p50,
                                    daysInactive:     $inactive,
                                    distanceKm:       $distance,
                                    d0Km:             null,
                                    completedJobs:    10,
                                );

                                $this->assertGreaterThanOrEqual(0.0, $b['s_organic']);
                                $this->assertLessThanOrEqual(1.0, $b['s_organic']);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * THE v3 "+2.0 cold-start bug" regression test (v3.2 §1.1).
     *
     * Under v3 §7.2 a brand-new Tier-1 provider's +2.0 boost beat the maximum
     * possible organic signal (≈1.9), so cold-start providers outranked
     * 5-star Tier-4 veterans in every query. With B_cold = 0.06 on a [0,1]
     * scale, a cold-start provider can never outrank a provider whose
     * S_organic exceeds theirs by more than the boost.
     */
    public function test_v3_plus_2_cold_start_bug_regression(): void
    {
        // (a) The exact v3 failure case: new Tier-1 vs 5-star Tier-4 veteran.
        $newTier1 = $this->ranking->scoreBreakdown(
            rBayes: 4.3, completionShrunk: 0.85, trustTier: 1, p50Mins: 45,
            daysInactive: 0.0, distanceKm: 3.0, d0Km: null, completedJobs: 0,
        );
        $veteranTier4 = $this->ranking->scoreBreakdown(
            rBayes: 4.9, completionShrunk: 0.98, trustTier: 4, p50Mins: 10,
            daysInactive: 1.0, distanceKm: 3.0, d0Km: null, completedJobs: 200,
        );

        $this->assertGreaterThan(0.0, $newTier1['b_cold'], 'cold boost should apply');
        $this->assertGreaterThan(
            $newTier1['score'],
            $veteranTier4['score'],
            'A 5-star Tier-4 veteran must outrank a boosted brand-new Tier-1 provider',
        );

        // (b) General bound: when S_organic differs by more than B_cold (0.06),
        // the boost can never flip the order (non-Tier-1 so M_tier = 1 both sides).
        $cold = $this->ranking->scoreBreakdown(
            rBayes: 4.0, completionShrunk: 0.85, trustTier: 2, p50Mins: 45,
            daysInactive: 0.0, distanceKm: 5.0, d0Km: null, completedJobs: 0,
        );
        $established = $this->ranking->scoreBreakdown(
            rBayes: 4.9, completionShrunk: 0.97, trustTier: 2, p50Mins: 12,
            daysInactive: 1.0, distanceKm: 5.0, d0Km: null, completedJobs: 80,
        );

        $this->assertGreaterThan(
            0.06,
            $established['s_organic'] - $cold['s_organic'],
            'fixture must separate organics by more than the boost',
        );
        $this->assertGreaterThan($cold['score'], $established['score']);
    }

    // ── §0.3 cold-start priors ───────────────────────────────────────────────

    public function test_shrinkage_priors(): void
    {
        // No history → exactly the prior
        $this->assertEqualsWithDelta(0.85, $this->ranking->shrunkCompletionRate(0, 0), 1e-9);

        // 30 completed of 32 ended → shrunk toward but not at the raw 0.9375
        $shrunk = $this->ranking->shrunkCompletionRate(30, 32);
        $this->assertGreaterThan(0.85, $shrunk);
        $this->assertLessThan(30 / 32, $shrunk);

        // Response-rate prior
        $this->assertSame(0.70, $this->ranking->responseRateOrPrior(null, false));
        $this->assertSame(0.95, $this->ranking->responseRateOrPrior(0.95, true));

        // p50 prior falls back to 60 before the nightly job has run…
        $this->assertSame(60, $this->ranking->categoryP50Prior(999));
        // …and serves the cached category median afterwards
        $this->ranking->storeCategoryP50Median(7, 42);
        $this->assertSame(42, $this->ranking->categoryP50Prior(7));
    }

    /**
     * §0.3 regression: a brand-new Tier-2 provider must (a) pass the 0.40
     * trust floor, and (b) rank below an established Tier-2 provider with
     * 30 jobs, 95% completion, 4.8 rating, at equal distance.
     */
    public function test_brand_new_tier2_passes_floor_but_ranks_below_established_tier2(): void
    {
        // Realistic platform context: c_mean averages ALL rated providers (not
        // just stars), and 30 completed jobs make a provider faster than their
        // category's median responder. With priors handed values identical to
        // an established peer's, a newcomer may sit within B_cold (0.06) of
        // them — that is the intended "a few positions, visible not dominant"
        // envelope, bounded by the +2.0 regression test above.
        $cMean = 4.0;
        $this->ranking->storeCategoryP50Median(12, 45);

        // (a) trust floor — priors make the newcomer credible but unproven
        $newTrust = $this->ranking->computeTrustScore(
            trustTier:            2,
            rRaw:                 0.0,
            vReviews:             0,
            cMean:                $cMean,
            completionRateShrunk: $this->ranking->shrunkCompletionRate(0, 0),
            responseRate7d:       $this->ranking->responseRateOrPrior(null, false),
            cancellationRate30d:  0.0,
            responseTimeP50Mins:  $this->ranking->categoryP50Prior(12),
            completedJobs:        0,
        );
        $this->assertGreaterThanOrEqual(
            $this->ranking->trustScoreFloor(),
            $newTrust,
            'A brand-new Tier-2 provider must pass the 0.40 search floor',
        );

        // §4.1 "Tier-1 onboarding isn't a dead end": even at Tier 1, with the
        // c_mean prior (an unrated launch-day platform) the priors must clear
        // the floor. Regression for the live bug where c_mean = 0 sank every
        // Tier-1 provider below 0.40 and emptied search.
        $tier1Trust = $this->ranking->computeTrustScore(
            trustTier:            1,
            rRaw:                 0.0,
            vReviews:             0,
            cMean:                (float) config('ranking.c_mean_prior'),
            completionRateShrunk: $this->ranking->shrunkCompletionRate(0, 0),
            responseRate7d:       $this->ranking->responseRateOrPrior(null, false),
            cancellationRate30d:  0.0,
            responseTimeP50Mins:  $this->ranking->categoryP50Prior(null),
            completedJobs:        0,
        );
        $this->assertGreaterThanOrEqual(
            $this->ranking->trustScoreFloor(),
            $tier1Trust,
            'A brand-new Tier-1 provider on an unrated platform must still pass the 0.40 floor',
        );

        // (b) ranking — equal distance, newcomer keeps the cold boost
        $newScore = $this->ranking->scoreBreakdown(
            rBayes:           $this->ranking->computeRBayes(0.0, 0, $cMean),
            completionShrunk: $this->ranking->shrunkCompletionRate(0, 0),
            trustTier:        2,
            p50Mins:          $this->ranking->categoryP50Prior(12),
            daysInactive:     0.0,
            distanceKm:       2.0,
            d0Km:             null,
            completedJobs:    0,
        );
        $establishedScore = $this->ranking->scoreBreakdown(
            rBayes:           $this->ranking->computeRBayes(4.8, 30, $cMean),
            completionShrunk: $this->ranking->shrunkCompletionRate(30, 32),
            trustTier:        2,
            p50Mins:          12,
            daysInactive:     0.0,
            distanceKm:       2.0,
            d0Km:             null,
            completedJobs:    30,
        );

        $this->assertSame(0.06, $newScore['b_cold']);
        $this->assertGreaterThan(
            $newScore['score'],
            $establishedScore['score'],
            'Demonstrated reliability must outrank cold-start priors at equal distance',
        );
    }

    // ── 0.2 Hard filters (isolated) ──────────────────────────────────────────

    public function test_hard_filters_each_gate(): void
    {
        $pass = fn (array $o = []) => $this->ranking->passesHardFilters(...array_merge([
            'trustTier'         => 2,
            'trustScore'        => 0.60,
            'accountState'      => 'ACTIVE',
            'denylisted'        => false,
            'requestedValueZmw' => 500.0,
        ], $o));

        $this->assertTrue($pass());

        $this->assertFalse($pass(['trustTier' => 0]),            'tier < 1 must fail');
        $this->assertFalse($pass(['trustScore' => 0.39]),        'trust below 0.40 floor must fail');
        $this->assertTrue($pass(['trustScore' => 0.40]),         'trust exactly at floor must pass');
        $this->assertFalse($pass(['accountState' => 'SUSPENDED']), 'non-ACTIVE account must fail');
        $this->assertFalse($pass(['denylisted' => true]),        'denylist hit must fail');

        // Tier cap vs requested value: Tier 1 caps at ZMW 300
        $this->assertFalse($pass(['trustTier' => 1, 'requestedValueZmw' => 500.0]));
        $this->assertTrue($pass(['trustTier' => 1, 'requestedValueZmw' => 250.0]));
        // Tier 4 is uncapped
        $this->assertTrue($pass(['trustTier' => 4, 'requestedValueZmw' => 50000.0]));
        // Unknown value (quote) is not capped at filter time
        $this->assertTrue($pass(['trustTier' => 1, 'requestedValueZmw' => null]));
    }

    // ── 0.2 Deterministic fairness slots ─────────────────────────────────────

    /** @param array<int, array{string, float}> $defs [provider_id, score] */
    private function rows(array $defs): array
    {
        return array_map(
            fn (array $d) => (object) ['provider_id' => $d[0], 'sort_score' => $d[1]],
            $defs,
        );
    }

    public function test_fairness_slots_reserve_positions_5_10_15_20_for_new_providers(): void
    {
        // 26 established rows (scores 1.00 down) + 4 new providers ranked last
        $defs = [];
        for ($i = 0; $i < 26; $i++) {
            $defs[] = ["est{$i}", 1.0 - $i * 0.01];
        }
        $defs[] = ['new1', 0.50];
        $defs[] = ['new2', 0.40];
        $defs[] = ['new3', 0.30];
        $defs[] = ['new4', 0.20];

        $jobMap = array_merge(
            array_combine(array_map(fn ($i) => "est{$i}", range(0, 25)), array_fill(0, 26, 50)),
            ['new1' => 0, 'new2' => 2, 'new3' => 5, 'new4' => 9],
        );

        $out = $this->ranking->applyFairnessSlots($this->rows($defs), $jobMap);

        // 1-indexed positions 5/10/15/20 → highest-scoring new providers in order
        $this->assertSame('new1', $out[4]->provider_id);
        $this->assertSame('new2', $out[9]->provider_id);
        $this->assertSame('new3', $out[14]->provider_id);
        $this->assertSame('new4', $out[19]->provider_id);

        // Everything else keeps organic (score-desc) order
        $this->assertSame('est0', $out[0]->provider_id);
        $this->assertSame('est3', $out[3]->provider_id);
        $this->assertSame('est4', $out[5]->provider_id);

        // Nothing lost or duplicated
        $this->assertCount(30, $out);
        $this->assertSame(
            collect($this->rows($defs))->pluck('provider_id')->sort()->values()->all(),
            collect($out)->pluck('provider_id')->sort()->values()->all(),
        );

        // Deterministic — same input, same output
        $this->assertEquals($out, $this->ranking->applyFairnessSlots($this->rows($defs), $jobMap));
    }

    public function test_fairness_slots_fall_back_to_organic_when_no_new_providers_qualify(): void
    {
        $defs = [];
        for ($i = 0; $i < 25; $i++) {
            $defs[] = ["est{$i}", 1.0 - $i * 0.01];
        }
        $jobMap = array_combine(array_map(fn ($i) => "est{$i}", range(0, 24)), array_fill(0, 25, 50));

        $rows = $this->rows($defs);
        $this->assertEquals($rows, $this->ranking->applyFairnessSlots($rows, $jobMap));
    }

    public function test_fairness_slots_do_not_duplicate_a_new_provider_already_ranked_organically(): void
    {
        // A new provider organically at position 1 must stay there; slot 5
        // takes the NEXT eligible new provider.
        $defs = [
            ['newTop', 0.99],
            ['est1', 0.90], ['est2', 0.89], ['est3', 0.88], ['est4', 0.87],
            ['est5', 0.86], ['newLow', 0.10],
        ];
        $jobMap = [
            'newTop' => 1, 'newLow' => 3,
            'est1' => 50, 'est2' => 50, 'est3' => 50, 'est4' => 50, 'est5' => 50,
        ];

        $out = $this->ranking->applyFairnessSlots($this->rows($defs), $jobMap);

        $this->assertSame('newTop', $out[0]->provider_id);
        $this->assertSame('newLow', $out[4]->provider_id);
        $this->assertCount(7, $out);
        $this->assertSame(7, count(array_unique(array_map(fn ($r) => $r->provider_id, $out))));
    }

    // ── v3 §7.5 diversity ────────────────────────────────────────────────────

    public function test_provider_diversity_caps_consecutive_results_at_two(): void
    {
        $rows = $this->rows([
            ['A', 0.9], ['A', 0.8], ['A', 0.7], ['B', 0.6], ['A', 0.5],
        ]);

        $out = array_map(fn ($r) => $r->provider_id, $this->ranking->applyProviderDiversity($rows));

        // Third consecutive A is deferred; later A after B resets the run
        $this->assertSame(['A', 'A', 'B', 'A', 'A'], $out);

        foreach ([0, 1, 2] as $i) {
            $run = array_slice($out, $i, 3);
            $this->assertNotSame(['A', 'A', 'A'], $run, 'No 3 consecutive results from one provider');
        }
    }
}
