<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * § DB-8 — prune passive observability tables (WhatsApp webhook logs, payment
 * events) older than the configured retention, so they don't grow without bound.
 * These rows back admin dashboards only; nothing reconciles against old rows.
 */
class PruneObservabilityLogs extends Command
{
    protected $signature   = 'logs:prune';
    protected $description = 'Delete observability log rows older than the configured retention.';

    public function handle(): int
    {
        $days   = (int) config('observability.retention_days', 90);
        $cutoff = now()->subDays($days);

        $wa      = DB::table('whatsapp_webhook_logs')->where('created_at', '<', $cutoff)->delete();
        $payments = DB::table('payment_events')->where('created_at', '<', $cutoff)->delete();

        if ($wa + $payments > 0) {
            $this->info("Pruned {$wa} webhook logs, {$payments} payment events (older than {$days}d).");
            Log::info('PruneObservabilityLogs: cycle complete', ['webhook_logs' => $wa, 'payment_events' => $payments, 'days' => $days]);
        }

        return self::SUCCESS;
    }
}
