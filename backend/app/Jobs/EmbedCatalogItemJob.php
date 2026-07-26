<?php

namespace App\Jobs;

use App\Models\Category;
use App\Models\Service;
use App\Services\Matching\EmbeddingIndexService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Event-driven re-embed: a service/category is (re)embedded when its text
 * changes. Dispatched from ServiceService writes and category admin writes.
 * Idempotent — EmbeddingIndexService skips a row whose source hash is unchanged.
 */
class EmbedCatalogItemJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;

    /** @param 'service'|'category' $type */
    public function __construct(
        public readonly string $type,
        public readonly string $id,
    ) {}

    public function handle(EmbeddingIndexService $index): void
    {
        try {
            if ($this->type === 'service') {
                $service = Service::with('category')->find($this->id);
                if ($service && $service->status === 'ACTIVE') {
                    $index->syncService($service);
                }
            } elseif ($this->type === 'category') {
                $category = Category::find($this->id);
                if ($category) {
                    $index->syncCategory($category);
                }
            }
        } catch (\Throwable $e) {
            Log::warning('EmbedCatalogItemJob failed', [
                'type' => $this->type, 'id' => $this->id, 'error' => $e->getMessage(),
            ]);
        }
    }
}
