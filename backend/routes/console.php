<?php

use App\Console\Commands\DisputeAutoCompleteWorker;
use App\Console\Commands\PaymentExpiryWorker;
use App\Console\Commands\PayoutRetryWorker;
use App\Jobs\ComputeTrustScoreJob;
use App\Services\BookingService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command("inspire", function () {
    $this->comment(Inspiring::quote());
})->purpose("Display an inspiring quote");

// ── Escrow Workers ────────────────────────────────────────────────────────────

// Auto-cancel PENDING_PAYMENT bookings past the payment TTL (default 60 min)
Schedule::command(PaymentExpiryWorker::class)->everyMinute()->withoutOverlapping();

// Retry failed PAY_OUT transactions per the exponential backoff schedule
Schedule::command(PayoutRetryWorker::class)->everyMinute()->withoutOverlapping();

// Auto-complete DELIVERED bookings after the dispute window (default 48 h)
Schedule::command(DisputeAutoCompleteWorker::class)->everyFifteenMinutes()->withoutOverlapping();

// Recompute §5.4 trust scores for all active providers nightly
Schedule::job(new ComputeTrustScoreJob)->dailyAt('02:00')->withoutOverlapping();

// Dispatch payout for all COMPLETED bookings whose hold window has expired (§8.6 — 4×/day)
Schedule::call(fn () => app(BookingService::class)->processDuePayouts())
    ->cron('0 0,6,12,18 * * *')
    ->name('payout-batch')
    ->withoutOverlapping();
