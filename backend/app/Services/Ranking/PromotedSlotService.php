<?php

namespace App\Services\Ranking;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * v3.2 §1.5 — promoted placement as reserved, labeled inventory.
 *
 * Promoted results NEVER blend into the organic score. Fixed result positions
 * 1 and 4 (1-indexed, page 1) carry promoted inventory when an ACTIVE
 * promoted_slots row matches the searched category × region AND the provider
 * already passed every hard filter and the geography gate (we only promote
 * rows that are in the organic candidate set). Otherwise organic results fill
 * those positions.
 *
 * Auction economics: generalized second price (v3 §8.5) with a reserve —
 * below-reserve bids are ignored, the winner pays max(next bid, reserve),
 * and a single bidder pays exactly the reserve.
 */
class PromotedSlotService
{
    /** 1-indexed result positions that carry promoted inventory. */
    public const PROMOTED_POSITIONS = [1, 4];

    /** Reserve = this fraction of the category-region median booking value. */
    public const RESERVE_FRACTION = 0.05;

    /** Fallback reserve when a category-region has no booking history yet. */
    public const RESERVE_FLOOR_ZMW = 5.00;

    /**
     * Move promoted-eligible rows to positions 1 and 4 and label every row.
     *
     * @param array<int, object> $rows Ranked rows (post fairness/diversity);
     *                                 promoted-eligible rows have ->has_promo_slot truthy.
     */
    public function injectPromoted(array $rows): array
    {
        $rows = array_values($rows);

        foreach ($rows as $row) {
            $row->placement = 'organic';
        }

        // Eligible rows in rank order; one slot per provider.
        $promoted  = [];
        $providers = [];
        foreach ($rows as $i => $row) {
            if (! empty($row->has_promo_slot) && ! isset($providers[$row->provider_id])) {
                $providers[$row->provider_id] = true;
                $promoted[$i] = $row;
                if (count($promoted) >= count(self::PROMOTED_POSITIONS)) {
                    break;
                }
            }
        }

        if (empty($promoted)) {
            return $rows;
        }

        $organic = [];
        foreach ($rows as $i => $row) {
            if (! isset($promoted[$i])) {
                $organic[] = $row;
            }
        }

        $promotedQueue = array_values($promoted);
        foreach ($promotedQueue as $row) {
            $row->placement = 'promoted';
        }

        // Rebuild: positions 1 and 4 (indexes 0 and 3) take promoted inventory;
        // organic order fills everything else.
        $out        = [];
        $organicPtr = 0;
        $promoPtr   = 0;
        $total      = count($rows);

        for ($pos = 1; $pos <= $total; $pos++) {
            if (in_array($pos, self::PROMOTED_POSITIONS, true) && $promoPtr < count($promotedQueue)) {
                $out[] = $promotedQueue[$promoPtr++];
            } elseif ($organicPtr < count($organic)) {
                $out[] = $organic[$organicPtr++];
            } else {
                $out[] = $promotedQueue[$promoPtr++];
            }
        }

        return $out;
    }

    /**
     * Generalized second price with reserve (v3 §8.5 + v3.2 §1.5).
     *
     * @param  float[] $bidsPerDay All bids for the category-region slot.
     * @return float|null Daily clearing price for the highest bidder, or null
     *                    when no bid meets the reserve (slot goes unsold).
     */
    public function clearingPrice(array $bidsPerDay, float $reservePerDay): ?float
    {
        $eligible = array_values(array_filter(
            array_map('floatval', $bidsPerDay),
            fn (float $bid) => $bid >= $reservePerDay,
        ));

        if (empty($eligible)) {
            return null;
        }

        rsort($eligible);

        // Single bidder pays the reserve; otherwise pay max(second bid, reserve).
        return count($eligible) === 1
            ? $reservePerDay
            : max($eligible[1], $reservePerDay);
    }

    /**
     * Recompute reserve prices for every category × region with booking
     * history: 5% of the median COMPLETED booking value over the last 90 days.
     * Called weekly by the promoted:recompute-reserves command.
     *
     * @return int rows upserted
     */
    public function recomputeReserves(): int
    {
        try {
            $rows = DB::select("
                SELECT s.category_id,
                       b.delivery_location_region AS region,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY b.amount) AS median_value
                FROM   bookings b
                JOIN   services s ON s.id = b.service_id
                WHERE  b.status = 'COMPLETED'
                  AND  b.delivery_location_region IS NOT NULL
                  AND  b.created_at >= NOW() - INTERVAL '90 days'
                GROUP  BY s.category_id, b.delivery_location_region
            ");
        } catch (\Throwable $e) {
            Log::error('PromotedSlotService::recomputeReserves failed', ['error' => $e->getMessage()]);
            return 0;
        }

        $upserted = 0;

        foreach ($rows as $row) {
            $median  = (float) $row->median_value;
            $reserve = max(self::RESERVE_FLOOR_ZMW, round($median * self::RESERVE_FRACTION, 2));

            DB::statement("
                INSERT INTO promoted_slot_reserves (category_id, region, reserve_per_day, median_booking_value, computed_at)
                VALUES (?, ?, ?, ?, NOW())
                ON CONFLICT (category_id, region)
                DO UPDATE SET reserve_per_day      = EXCLUDED.reserve_per_day,
                              median_booking_value = EXCLUDED.median_booking_value,
                              computed_at          = EXCLUDED.computed_at
            ", [$row->category_id, $row->region, $reserve, $median]);

            $upserted++;
        }

        return $upserted;
    }
}
