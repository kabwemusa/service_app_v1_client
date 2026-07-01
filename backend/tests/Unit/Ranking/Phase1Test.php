<?php

namespace Tests\Unit\Ranking;

use App\Services\BookingConflictService;
use App\Services\Location\GazetteerService;
use App\Services\Location\GeocodingService;
use App\Services\Ranking\PromotedSlotService;
use App\Support\Geohash;
use App\Support\Stats;
use Carbon\Carbon;
use Illuminate\Support\Facades\Http;
use Mockery;
use Tests\TestCase;

/**
 * Phase 1 required tests:
 *  - §1.5 promoted inventory at positions 1/4, structural labels, no blending
 *  - §1.5 second-price auction with reserve (single bidder pays reserve)
 *  - §1.6 transit math (circuity 1.35, peak/off-peak speeds)
 *  - §3.1/§3.2 geohash codec, reverse-geocode cache (no driver call on hit),
 *    gazetteer-above-external autocomplete merge
 *  - §7 Gini helper
 */
class Phase1Test extends TestCase
{
    // ── Geohash ──────────────────────────────────────────────────────────────

    public function test_geohash_encodes_known_vector(): void
    {
        // Canonical test vector (Wikipedia): 57.64911, 10.40744 → u4pruydqqvj
        $this->assertSame('u4pruy', Geohash::encode(57.64911, 10.40744, 6));
        $this->assertSame('u4pruydqqvj', Geohash::encode(57.64911, 10.40744, 11));
    }

    public function test_geohash_decode_roundtrip_and_cell_stability(): void
    {
        // Lusaka CBD — decode of encode lands inside the same cell
        $hash     = Geohash::encode(-15.4167, 28.2833, 6);
        $centroid = Geohash::decode($hash);
        $this->assertSame($hash, Geohash::encode($centroid['lat'], $centroid['lng'], 6));

        // Two GPS fixes metres apart share the geohash-6 cell (cache hits)
        $this->assertSame(
            Geohash::encode(-15.41670, 28.28330, 6),
            Geohash::encode(-15.41675, 28.28335, 6),
        );
    }

    // ── §1.5 promoted inventory ──────────────────────────────────────────────

    /** @param array<int, array{string, bool}> $defs [provider_id, has_promo] */
    private function promoRows(array $defs): array
    {
        return array_map(fn (array $d) => (object) [
            'provider_id'    => $d[0],
            'has_promo_slot' => $d[1],
            'sort_score'     => 0.0,
        ], $defs);
    }

    public function test_promoted_rows_occupy_positions_1_and_4(): void
    {
        $svc  = new PromotedSlotService();
        $rows = $this->promoRows([
            ['a', false], ['b', false], ['c', true], ['d', false],
            ['e', true],  ['f', false], ['g', false],
        ]);

        $out = $svc->injectPromoted($rows);
        $ids = array_map(fn ($r) => $r->provider_id, $out);

        // Highest-ranked promo-eligible rows move to positions 1 and 4
        $this->assertSame('c', $ids[0]);
        $this->assertSame('e', $ids[3]);
        $this->assertSame('promoted', $out[0]->placement);
        $this->assertSame('promoted', $out[3]->placement);

        // Organic order is untouched in between — no score blending anywhere
        $this->assertSame(['c', 'a', 'b', 'e', 'd', 'f', 'g'], $ids);
        foreach ([1, 2, 4, 5, 6] as $i) {
            $this->assertSame('organic', $out[$i]->placement);
        }

        // Nothing lost or duplicated
        $this->assertCount(7, $out);
        $this->assertCount(7, array_unique($ids));
    }

    public function test_organic_results_fill_promoted_positions_when_no_slot_matches(): void
    {
        $svc  = new PromotedSlotService();
        $rows = $this->promoRows([['a', false], ['b', false], ['c', false], ['d', false], ['e', false]]);

        $out = $svc->injectPromoted($rows);

        $this->assertSame(['a', 'b', 'c', 'd', 'e'], array_map(fn ($r) => $r->provider_id, $out));
        foreach ($out as $row) {
            $this->assertSame('organic', $row->placement);
        }
    }

    public function test_single_promoted_row_takes_position_1_and_organic_fills_4(): void
    {
        $svc  = new PromotedSlotService();
        $rows = $this->promoRows([['a', false], ['b', true], ['c', false], ['d', false], ['e', false]]);

        $out = $svc->injectPromoted($rows);
        $ids = array_map(fn ($r) => $r->provider_id, $out);

        $this->assertSame('b', $ids[0]);
        $this->assertSame('promoted', $out[0]->placement);
        $this->assertSame(['b', 'a', 'c', 'd', 'e'], $ids);
        $this->assertSame('organic', $out[3]->placement);
    }

    // ── §1.5 second-price auction with reserve ───────────────────────────────

    public function test_auction_clearing_price_with_reserve(): void
    {
        $svc = new PromotedSlotService();

        // Single bidder pays exactly the reserve — never ~0
        $this->assertSame(10.0, $svc->clearingPrice([45.0], 10.0));

        // Two bidders: winner pays the second price (≥ reserve)
        $this->assertSame(30.0, $svc->clearingPrice([45.0, 30.0], 10.0));

        // Second price below reserve → reserve wins
        $this->assertSame(10.0, $svc->clearingPrice([45.0, 5.0], 10.0));

        // No bid meets the reserve → slot unsold
        $this->assertNull($svc->clearingPrice([5.0, 8.0], 10.0));
        $this->assertNull($svc->clearingPrice([], 10.0));
    }

    // ── §1.6 transit math ────────────────────────────────────────────────────

    public function test_transit_minutes_apply_circuity_and_peak_speeds(): void
    {
        $conflict = new BookingConflictService();

        // 10 km straight-line → 13.5 km road (×1.35).
        // Off-peak (13:00): 13.5 / 30 km/h = 27 min + 15 buffer = 42
        $offPeak = Carbon::parse('2026-06-11 13:00', 'Africa/Lusaka');
        $this->assertEqualsWithDelta(42.0, $conflict->requiredTransitMinutes(10.0, $offPeak), 0.01);

        // Morning peak (08:00): 13.5 / 20 km/h = 40.5 min + 15 = 55.5
        $amPeak = Carbon::parse('2026-06-11 08:00', 'Africa/Lusaka');
        $this->assertEqualsWithDelta(55.5, $conflict->requiredTransitMinutes(10.0, $amPeak), 0.01);

        // Evening peak (17:30) matches morning peak speed
        $pmPeak = Carbon::parse('2026-06-11 17:30', 'Africa/Lusaka');
        $this->assertEqualsWithDelta(55.5, $conflict->requiredTransitMinutes(10.0, $pmPeak), 0.01);

        // Window boundaries: 06:30 is peak, 09:00 is not
        $this->assertEqualsWithDelta(55.5, $conflict->requiredTransitMinutes(10.0, Carbon::parse('2026-06-11 06:30', 'Africa/Lusaka')), 0.01);
        $this->assertEqualsWithDelta(42.0, $conflict->requiredTransitMinutes(10.0, Carbon::parse('2026-06-11 09:00', 'Africa/Lusaka')), 0.01);
    }

    // ── §3.2 reverse-geocode cache ───────────────────────────────────────────

    public function test_reverse_geocode_caches_by_geohash6_and_skips_driver_on_hit(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([
                'display_name' => 'Kabwata, Lusaka, Lusaka Province, Zambia',
                'address'      => ['suburb' => 'Kabwata', 'state' => 'Lusaka Province'],
            ]),
        ]);

        $gazetteer = Mockery::mock(GazetteerService::class);
        // Reverse snapping (v3.2 §3.1) consults the gazetteer for the cell's
        // canonical region; no entry here ⇒ raw OSM regions are kept.
        $gazetteer->shouldReceive('regionFor')->andReturn(null);
        $service   = new GeocodingService($gazetteer);

        $first = $service->reverseGeocode(-15.41670, 28.28330);
        $this->assertSame('Kabwata, Lusaka', $first['label']);
        $this->assertSame('Lusaka Province', $first['region_province']);
        $this->assertSame('Kabwata', $first['region_ward']);

        // Second fix metres away — same geohash-6 cell → served from cache,
        // the external geocoder is NOT called again.
        $second = $service->reverseGeocode(-15.41675, 28.28335);
        $this->assertSame('Kabwata, Lusaka', $second['label']);
        $this->assertSame(-15.41675, $second['lat']); // exact coords preserved

        Http::assertSentCount(1);
    }

    // ── §3.1 gazetteer-above-external autocomplete ───────────────────────────

    public function test_gazetteer_matches_rank_above_external_results(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([
                [
                    'display_name' => 'Kabwata Market, Lusaka, Zambia',
                    'lat' => '-15.43', 'lon' => '28.30',
                    'address' => ['state' => 'Lusaka Province', 'suburb' => 'Kabwata'],
                ],
            ]),
        ]);

        $gazetteer = Mockery::mock(GazetteerService::class);
        $gazetteer->shouldReceive('matches')->once()->with('kabwata', 5)->andReturn([
            [
                'label'           => 'Kabwata Site & Service',
                'place_name'      => 'Kabwata Site & Service',
                'region_province' => 'Lusaka Province',
                'region_ward'     => 'Kabwata',
                'lat'             => -15.428,
                'lng'             => 28.302,
                'gazetteer'       => true,
            ],
        ]);

        $service = new GeocodingService($gazetteer);
        $results = $service->search('kabwata');

        $this->assertGreaterThanOrEqual(2, count($results));
        // Our own confirmed entry outranks the external provider's
        $this->assertTrue($results[0]['gazetteer']);
        $this->assertSame('Kabwata Site & Service', $results[0]['label']);
        $this->assertFalse($results[1]['gazetteer']);
        $this->assertSame('Kabwata Market, Lusaka', $results[1]['label']);
    }

    // ── §7 Gini ──────────────────────────────────────────────────────────────

    public function test_gini_coefficient(): void
    {
        // Perfect equality → 0
        $this->assertEqualsWithDelta(0.0, Stats::gini([5, 5, 5, 5]), 1e-9);

        // One provider takes everything (n = 4) → 0.75
        $this->assertEqualsWithDelta(0.75, Stats::gini([0, 0, 0, 100]), 1e-9);

        // Empty / all-zero distributions are defined as 0
        $this->assertSame(0.0, Stats::gini([]));
        $this->assertSame(0.0, Stats::gini([0, 0]));

        // Monotonic: more concentration → higher Gini
        $this->assertGreaterThan(Stats::gini([3, 3, 3, 3]), Stats::gini([1, 1, 1, 9]));
    }
}
