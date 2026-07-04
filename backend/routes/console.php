<?php

use App\Console\Commands\BookingExpiryWorker;
use App\Console\Commands\DisputeAutoCompleteWorker;
use App\Console\Commands\PaymentExpiryWorker;
use App\Console\Commands\PayoutRetryWorker;
use App\Jobs\ComputeTrustScoreJob;
use App\Jobs\ConversationTimeoutJob;
use App\Services\BookingService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command("inspire", function () {
    $this->comment(Inspiring::quote());
})->purpose("Display an inspiring quote");

// ── DIRECT Workers ───────────────────────────────────────────────────────────

// Expire REQUESTED bookings with no provider response within BOOKING_RESPONSE_WINDOW_HOURS
Schedule::command(BookingExpiryWorker::class)->everyFiveMinutes()->withoutOverlapping();

// ── Escrow Workers ────────────────────────────────────────────────────────────

// Auto-cancel PENDING_PAYMENT bookings past the payment TTL (default 30 min)
Schedule::command(PaymentExpiryWorker::class)->everyMinute()->withoutOverlapping();

// Retry failed PAY_OUT transactions per the exponential backoff schedule
Schedule::command(PayoutRetryWorker::class)->everyMinute()->withoutOverlapping();

// Provider went dark: cancel + refund FUNDS_HELD bookings whose scheduled
// window ended a grace period ago without the job starting
Schedule::command(\App\Console\Commands\NoShowExpiryWorker::class)->everyFifteenMinutes()->withoutOverlapping();

// Auto-complete DELIVERED bookings after the dispute window (default 48 h)
Schedule::command(DisputeAutoCompleteWorker::class)->everyFifteenMinutes()->withoutOverlapping();

// Recompute §5.4 trust scores for all active providers nightly
Schedule::job(new ComputeTrustScoreJob)->dailyAt('02:00')->withoutOverlapping();

// v3.2 §1.5 — promoted-slot auction reserves (5% of category-region median booking value)
Schedule::command(\App\Console\Commands\RecomputePromotedReservesCommand::class)
    ->weeklyOn(1, '03:00')
    ->withoutOverlapping();

// v3.2 §6 — close post-a-request broadcasts whose time window has passed
Schedule::call(fn () => app(\App\Services\ServiceRequestService::class)->expireStale())
    ->everyFifteenMinutes()
    ->name('service-requests-expire')
    ->withoutOverlapping();

// v3.2 §7 — weekly north-star metric snapshots (after the week closes)
Schedule::command(\App\Console\Commands\MetricsWeeklyCommand::class)
    ->weeklyOn(1, '03:30')
    ->withoutOverlapping();

// WhatsApp conversation timeouts (collecting nudge/expiry, accept window, funding window)
Schedule::job(new ConversationTimeoutJob)->everyMinute()->withoutOverlapping();

// Dispatch payout for all COMPLETED bookings whose hold window has expired (§8.6 — 4×/day)
Schedule::call(fn () => app(BookingService::class)->processDuePayouts())
    ->cron('0 0,6,12,18 * * *')
    ->name('payout-batch')
    ->withoutOverlapping();
