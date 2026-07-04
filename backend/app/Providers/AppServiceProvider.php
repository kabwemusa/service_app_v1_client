<?php

namespace App\Providers;

use App\Contracts\DispatchService;
use App\Contracts\IdentityVerificationProviderInterface;
use App\Contracts\ImageModerationProvider;
use App\Contracts\PaymentGateway;
use App\Contracts\SmsGateway;
use App\Contracts\TrustEngine;
use App\Contracts\WalletNameLookupInterface;
use App\Contracts\WhatsAppGateway;
use App\Models\Booking;
use App\Models\EmergencyEvent;
use App\Models\IdentityDocument;
use App\Models\ReviewFlag;
use App\Models\SafetyReport;
use App\Observers\BookingFinanceObserver;
use App\Observers\EmergencyEventObserver;
use App\Observers\IdentityDocumentObserver;
use App\Observers\ReviewFlagObserver;
use App\Observers\SafetyReportObserver;
use App\Services\Dispatch\RealDispatchService;
use App\Services\Dispatch\RealTrustEngine;
use App\Services\Gateway\PawapayPaymentGateway;
use App\Services\Gateway\StubPaymentGateway;
use App\Services\Gateway\StubWhatsAppGateway;
use App\Services\IdentityVerification\MockIdentityVerificationProvider;
use App\Services\Payment\MockWalletNameProvider;
use App\Services\WhatsApp\CloudApiAdapter;
use App\Services\WhatsApp\TestPaymentGateway;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(
            IdentityVerificationProviderInterface::class,
            MockIdentityVerificationProvider::class,
        );

        $this->app->bind(
            WalletNameLookupInterface::class,
            MockWalletNameProvider::class,
        );

        // §5.3 portfolio image pipeline (NSFW / pHash-duplicate / EXIF) — stub in
        // dev/CI; swap for a real classifier in production.
        $this->app->bind(
            ImageModerationProvider::class,
            \App\Services\IdentityVerification\StubImageModerationProvider::class,
        );

        // TrustEngine — real implementation (classification + eligibility + scoring)
        $this->app->bind(TrustEngine::class, RealTrustEngine::class);

        // SmsGateway — Africa's Talking when configured, otherwise log-only stub
        // (the OTP is written to the log so the phone-OTP flow works locally).
        $this->app->bind(SmsGateway::class, \App\Services\Gateway\LogSmsGateway::class);

        // DispatchService — real implementation (shortlist + auto + cascade + fairness)
        $this->app->bind(DispatchService::class, RealDispatchService::class);

        // WhatsAppGateway — Cloud API when token set, otherwise stub
        if (config('whatsapp.access_token')) {
            $this->app->bind(WhatsAppGateway::class, CloudApiAdapter::class);
        } else {
            $this->app->bind(WhatsAppGateway::class, StubWhatsAppGateway::class);
        }

        // PaymentGateway — PawaPay when enabled, test stub in test mode, otherwise stub
        if (config('pawapay.enabled')) {
            $this->app->bind(PaymentGateway::class, PawapayPaymentGateway::class);
        } elseif (config('whatsapp.test_mode')) {
            $this->app->bind(PaymentGateway::class, TestPaymentGateway::class);
        } else {
            $this->app->bind(PaymentGateway::class, StubPaymentGateway::class);
        }
    }

    public function boot(): void
    {
        // Admin real-time queue events — fire off the model layer so any
        // producer of these rows (current or future) reaches the admin
        // queues live, without touching each controller/job individually.
        IdentityDocument::observe(IdentityDocumentObserver::class);
        Booking::observe(BookingFinanceObserver::class);
        SafetyReport::observe(SafetyReportObserver::class);
        EmergencyEvent::observe(EmergencyEventObserver::class);
        ReviewFlag::observe(ReviewFlagObserver::class);
    }
}
