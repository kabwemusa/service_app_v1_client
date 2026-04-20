<?php

namespace App\Console\Commands;

use App\Services\PaymentService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Runs every minute via the scheduler.
 *
 * Processes the PAY_OUT retry queue — finds all FAILED transactions
 * with next_retry_at <= NOW() and attempts disbursement again using
 * the exponential backoff schedule defined in config/payment.php.
 */
class PayoutRetryWorker extends Command
{
    protected $signature   = "escrow:retry-payouts";
    protected $description = "Retry failed payout transactions per the exponential backoff schedule.";

    public function __construct(private readonly PaymentService $payment)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $result = $this->payment->processRetryQueue();

        if ($result["attempted"] === 0) {
            return self::SUCCESS;
        }

        $this->info("Payout retry: attempted={$result["attempted"]}, succeeded={$result["succeeded"]}");

        Log::info("PayoutRetryWorker: cycle complete", $result);

        return self::SUCCESS;
    }
}
