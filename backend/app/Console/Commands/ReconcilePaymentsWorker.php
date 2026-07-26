<?php

namespace App\Console\Commands;

use App\Services\PaymentReconciliationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * § ERR-2 — re-attempts money-path calls (refunds / payouts / balance
 * collections) that failed after the local state was committed. Runs every
 * minute; each item backs off on repeated failure and is ABANDONED for manual
 * handling after the configured max attempts.
 */
class ReconcilePaymentsWorker extends Command
{
    protected $signature   = 'payments:reconcile';
    protected $description = 'Retry failed money-path external calls (refunds/payouts/balance collections).';

    public function __construct(private readonly PaymentReconciliationService $reconciliation)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $result = $this->reconciliation->retryDue();

        if ($result['attempted'] === 0) {
            return self::SUCCESS;
        }

        $this->info("Reconcile: attempted={$result['attempted']}, resolved={$result['resolved']}, abandoned={$result['abandoned']}");
        Log::info('ReconcilePaymentsWorker: cycle complete', $result);

        return self::SUCCESS;
    }
}
