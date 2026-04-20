<?php

namespace App\Console\Commands;

use App\Services\TypesenseService;
use Illuminate\Console\Command;

class TypesenseSyncCommand extends Command
{
    protected $signature   = 'typesense:sync';
    protected $description = 'Re-index all active services into Typesense (full rebuild).';

    public function handle(TypesenseService $typesense): int
    {
        $this->info('Ensuring Typesense collection exists…');

        if (! $typesense->ensureCollection()) {
            $this->error('Could not connect to Typesense. Is the container running?');
            return self::FAILURE;
        }

        $this->info('Syncing services to Typesense…');

        $result = $typesense->bulkSync();

        if ($result['errors'] === -1) {
            $this->error('Sync failed — Typesense unreachable.');
            return self::FAILURE;
        }

        $this->table(
            ['Indexed', 'Errors'],
            [[$result['indexed'], $result['errors']]],
        );

        return $result['errors'] === 0 ? self::SUCCESS : self::FAILURE;
    }
}
