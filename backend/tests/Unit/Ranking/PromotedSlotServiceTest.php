<?php

namespace Tests\Unit\Ranking;

use App\Services\Ranking\PromotedSlotService;
use Tests\TestCase;

/**
 * Phase 1 §1.5 — promoted inventory at positions 1/4 and the
 * second-price-with-reserve auction math.
 */
class PromotedSlotServiceTest extends TestCase
{
    private PromotedSlotService $slots;

    protected function setUp(): void
    {
        parent::setUp();
        $this->slots = new PromotedSlotService();
    }

    /** @param array<int, array{string, bool}> $defs [provider_id, has_promo_slot] */
    private function rows(array $defs): array
    {
        return array_map(
            fn (array $d) => (object) ['provider_id' => $d[0], 'has_promo_slot' => $d[1]],
            $defs,
        );
    }

    public function test_promoted_rows_move_to_positions_1_and_4(): void
    {
        $out = $this->slots->injectPromoted($this->rows([
            ['a', false], ['b', false], ['c', true], ['d', false],
            ['e', true],  ['f', false], ['g', false],
        ]));

        // Highest-ranked promo-eligible rows occupy positions 1 and 4 (idx 0, 3)
        $this->assertSame('c', $out[0]->provider_id);
        $this->assertSame('promoted', $out[0]->placement);
        $this->assertSame('e', $out[3]->provider_id);
        $this->assertSame('promoted', $out[3]->placement);

        // Organic order fills everything else, labeled organic
        $this->assertSame(['a', 'b', 'd', 'f', 'g'], array_values(array_map(
            fn ($r) => $r->provider_id,
            array_filter($out, fn ($r) => $r->placement === 'organic'),
        )));

        // Nothing lost or duplicated
        $this->assertCount(7, $out);
        $this->assertCount(7, array_unique(array_map(fn ($r) => $r->provider_id, $out)));
    }

    public function test_organic_results_fill_slots_when_no_promoted_inventory(): void
    {
        $rows = $this->rows([['a', false], ['b', false], ['c', false]]);
        $out  = $this->slots->injectPromoted($rows);

        $this->assertSame(['a', 'b', 'c'], array_map(fn ($r) => $r->provider_id, $out));
        $this->assertSame(['organic', 'organic', 'organic'], array_map(fn ($r) => $r->placement, $out));
    }

    public function test_one_promoted_slot_per_provider(): void
    {
        // Same provider holding multiple eligible rows takes only ONE slot
        $out = $this->slots->injectPromoted($this->rows([
            ['a', true], ['a', true], ['b', false], ['c', true], ['d', false],
        ]));

        $promoted = array_values(array_filter($out, fn ($r) => $r->placement === 'promoted'));
        $this->assertCount(2, $promoted);
        $this->assertSame(['a', 'c'], array_map(fn ($r) => $r->provider_id, $promoted));
    }

    // ── Auction: second price with reserve ───────────────────────────────────

    public function test_single_bidder_pays_the_reserve(): void
    {
        $this->assertSame(10.0, $this->slots->clearingPrice([45.0], 10.0));
    }

    public function test_winner_pays_max_of_second_bid_and_reserve(): void
    {
        $this->assertSame(30.0, $this->slots->clearingPrice([45.0, 30.0, 12.0], 10.0));
        // Second bid below reserve drops out → effectively a single bidder → reserve
        $this->assertSame(31.0, $this->slots->clearingPrice([45.0, 30.0], 31.0));
    }

    public function test_below_reserve_bids_are_ignored(): void
    {
        // Second bid below reserve → winner pays the reserve
        $this->assertSame(20.0, $this->slots->clearingPrice([45.0, 15.0], 20.0));
        // No bid meets the reserve → slot unsold
        $this->assertNull($this->slots->clearingPrice([5.0, 8.0], 20.0));
        $this->assertNull($this->slots->clearingPrice([], 20.0));
    }
}
