<?php

namespace App\Console\Commands;

use App\Services\Ranking\PromotedSlotService;
use Illuminate\Console\Command;

/**
 * v3.2 §1.5 — weekly reserve-price recompute: 5% of the category-region
 * median COMPLETED booking value (last 90 days).
 */
class RecomputePromotedReservesCommand extends Command
{
    protected $signature   = 'promoted:recompute-reserves';
    protected $description = 'Recompute promoted-slot auction reserve prices per category × region';

    public function handle(PromotedSlotService $slots): int
    {
        $upserted = $slots->recomputeReserves();

        $this->info("Reserve prices recomputed for {$upserted} category-region pairs.");

        return self::SUCCESS;
    }
}
