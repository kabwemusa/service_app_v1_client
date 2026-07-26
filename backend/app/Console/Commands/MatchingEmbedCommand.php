<?php

namespace App\Console\Commands;

use App\Services\Matching\EmbeddingIndexService;
use Illuminate\Console\Command;

/**
 * Bulk (re)embed the catalog for the natural-language matcher's semantic layer.
 * Mirrors `typesense:sync`. Event-driven re-embedding keeps rows fresh; this is
 * the full rebuild (e.g. after switching embedding provider — use --force).
 */
class MatchingEmbedCommand extends Command
{
    protected $signature   = 'matching:embed {--force : Re-embed every row even if its text is unchanged}';
    protected $description = 'Compute embeddings for all active categories and services (semantic matcher index).';

    public function handle(EmbeddingIndexService $index): int
    {
        $this->info('Embedding catalog (categories + services)…');

        $result = $index->syncAll((bool) $this->option('force'));

        $this->table(
            ['Categories embedded', 'Services embedded'],
            [[$result['categories'], $result['services']]],
        );

        return self::SUCCESS;
    }
}
