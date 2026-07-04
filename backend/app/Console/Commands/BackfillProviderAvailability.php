<?php

namespace App\Console\Commands;

use App\Models\ProviderProfile;
use App\Services\AvailabilityService;
use Illuminate\Console\Command;

/**
 * One-time bridge for providers who set weekly hours before the
 * provider_availability table became the dispatch source of truth: converts
 * each profile's availability_matrix JSONB into relational recurring slots.
 *
 * Idempotent — setSchedule replaces the recurring rows wholesale. Profiles
 * that already have recurring rows are skipped unless --force is passed, so
 * a re-run never clobbers a schedule edited via the new availability screens.
 */
class BackfillProviderAvailability extends Command
{
    protected $signature   = 'availability:backfill {--force : Overwrite providers that already have recurring rows}';
    protected $description = 'Convert availability_matrix JSONB into provider_availability rows (WhatsApp/dispatch source of truth).';

    public function handle(AvailabilityService $availability): int
    {
        $profiles = ProviderProfile::whereNotNull('availability_matrix')->get();

        $synced  = 0;
        $skipped = 0;

        foreach ($profiles as $profile) {
            $matrix = (array) $profile->availability_matrix;
            if (empty($matrix)) {
                continue;
            }

            if (! $this->option('force') && ! empty($availability->getSchedule($profile->user_id))) {
                $skipped++;
                continue;
            }

            $availability->syncFromMatrix($profile->user_id, $matrix);
            $synced++;
        }

        $this->info("Synced {$synced} provider(s); skipped {$skipped} with existing schedules.");

        return self::SUCCESS;
    }
}
