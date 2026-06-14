<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * v3.2 §7 — append-only impressions log, written off the search hot path.
 * The impression id is generated synchronously in SearchService so the
 * response can carry it for result_clicked / booking_started events.
 */
class LogSearchImpressionJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    /**
     * @param array<int, array{provider_id: string, service_id: string, placement: string, score: float, components: array}> $results
     */
    public function __construct(
        public readonly string  $impressionId,
        public readonly ?string $userId,
        public readonly ?int    $categoryId,
        public readonly ?string $geohash5,
        public readonly string  $requestedAt,
        public readonly array   $results,
    ) {}

    public function handle(): void
    {
        try {
            DB::table('search_impressions')->insert([
                'id'           => $this->impressionId,
                'user_id'      => $this->userId,
                'category_id'  => $this->categoryId,
                'geohash5'     => $this->geohash5,
                'requested_at' => $this->requestedAt,
                'results'      => json_encode($this->results),
            ]);
        } catch (\Throwable $e) {
            // Instrumentation must never disturb serving traffic — log and move on.
            Log::warning('LogSearchImpressionJob failed', ['error' => $e->getMessage()]);
        }
    }
}
