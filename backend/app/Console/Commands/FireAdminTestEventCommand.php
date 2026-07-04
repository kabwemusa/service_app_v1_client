<?php

namespace App\Console\Commands;

use App\Events\AdminQueueEvent;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Dev-only helper to fire an AdminQueueEvent directly, for QA-verifying the
 * admin real-time pipeline for event types whose real producer doesn't exist
 * yet (review.flagged's report-a-review endpoint, emergency.triggered's
 * panic-button endpoint — both out of scope for this phase). Every other
 * type already has a real producer and should be exercised through it
 * instead of this command.
 */
class FireAdminTestEventCommand extends Command
{
    protected $signature = 'admin:fire-test-event {type : One of verification.submitted|booking.funds_held|booking.disbursed|booking.cancelled|safety.report_filed|emergency.triggered|review.flagged|service.flagged}';
    protected $description = 'Fire a synthetic AdminQueueEvent for manually QA-testing the admin realtime pipeline';

    private const TYPE_MODULE = [
        'verification.submitted' => 'verification',
        'booking.funds_held'     => 'finance',
        'booking.disbursed'      => 'finance',
        'booking.cancelled'      => 'finance',
        'safety.report_filed'    => 'safety',
        'emergency.triggered'    => 'safety',
        'review.flagged'         => 'reviews',
        'service.flagged'        => 'services',
    ];

    public function handle(): int
    {
        $type = $this->argument('type');
        $module = self::TYPE_MODULE[$type] ?? null;

        if ($module === null) {
            $this->error("Unknown event type \"{$type}\". Valid types: ".implode(', ', array_keys(self::TYPE_MODULE)));
            return self::FAILURE;
        }

        $entityId = (string) Str::uuid();

        AdminQueueEvent::dispatch($module, $type, $entityId, [
            'test'    => true,
            'note'    => 'Synthetic event fired via admin:fire-test-event',
            'fired_at'=> now()->toIso8601String(),
        ]);

        $this->info("Fired \"{$type}\" on channel private-admin.{$module} (entity_id={$entityId}).");

        return self::SUCCESS;
    }
}
