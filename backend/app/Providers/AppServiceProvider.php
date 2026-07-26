<?php

namespace App\Providers;

use App\Contracts\DispatchService;
use App\Contracts\EmbeddingProvider;
use App\Contracts\IdentityVerificationProviderInterface;
use App\Contracts\ImageModerationProvider;
use App\Contracts\PaymentGateway;
use App\Contracts\ServiceDisambiguator;
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
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
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

        // Matching engine — Layer 2 embeddings + Layer 3 disambiguation. Drivers
        // are config-selected; the keyless 'hash'/'null' defaults keep the whole
        // pipeline testable offline (swap to openai/anthropic in production).
        $this->app->singleton(EmbeddingProvider::class, function () {
            return match (config('matching.embeddings.driver', 'hash')) {
                'openai' => new \App\Services\Matching\Embeddings\OpenAiEmbeddingProvider(),
                default  => new \App\Services\Matching\Embeddings\HashEmbeddingProvider(),
            };
        });

        $this->app->bind(ServiceDisambiguator::class, function () {
            return match (config('matching.llm.driver', 'null')) {
                'anthropic' => new \App\Services\Matching\Llm\AnthropicDisambiguator(),
                default     => new \App\Services\Matching\Llm\NullDisambiguator(),
            };
        });

        // MaskedCallProvider — privacy-preserving voice. Africa's Talking is the
        // only Zambia-native voice API; 'log' is the offline/test default; 'reveal'
        // is the FLAGGED time-limited-reveal fallback used only when masking can't
        // be provisioned (see config/communication.php + LEGAL_REVIEW.md).
        $this->app->bind(\App\Contracts\MaskedCallProvider::class, function () {
            return match (config('communication.calling.provider', 'log')) {
                'africastalking' => new \App\Services\Communication\AfricasTalkingCallProvider(),
                'reveal'         => new \App\Services\Communication\ConsentedRevealProvider(),
                default          => new \App\Services\Communication\LogMaskedCallProvider(),
            };
        });

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

        $this->configureRateLimiters();
    }

    /**
     * Named API rate limiters (applied via `throttle:<name>` in routes/api.php).
     * Abuse surfaces get tight per-IP limits; authenticated writes are keyed on
     * the user so one client can't be throttled by a shared NAT. All limits are
     * env-tunable so ops can adjust without a deploy.
     */
    private function configureRateLimiters(): void
    {
        // Limits come from config (cached), not env() — a closure runs at request
        // time and env() would be ignored under config:cache (§ CFG).
        // Credential + code endpoints — brute force / stuffing / SMS pumping.
        RateLimiter::for('auth', fn (Request $r) => [
            Limit::perMinute((int) config('ratelimits.auth', 5))->by($r->ip()),
        ]);

        // OTP request/verify — per phone AND per IP (the phone is in the body).
        RateLimiter::for('otp', function (Request $r) {
            $phone = (string) ($r->input('phone') ?? $r->input('user_id') ?? '');
            $limit = (int) config('ratelimits.otp', 5);
            return [
                Limit::perMinute($limit)->by($r->ip()),
                Limit::perMinute($limit)->by('otp:' . $phone),
            ];
        });

        // Public LLM-backed matcher — direct cost abuse if unbounded.
        RateLimiter::for('match', fn (Request $r) => [
            Limit::perMinute((int) config('ratelimits.match', 20))->by($r->user()?->getAuthIdentifier() ?: $r->ip()),
        ]);

        // Public search / suggest / fire-and-forget events.
        RateLimiter::for('search', fn (Request $r) => [
            Limit::perMinute((int) config('ratelimits.search', 60))->by($r->ip()),
        ]);

        // Authenticated mutations (booking, etc.) — keyed on the user.
        RateLimiter::for('write', fn (Request $r) => [
            Limit::perMinute((int) config('ratelimits.write', 60))->by($r->user()?->getAuthIdentifier() ?: $r->ip()),
        ]);

        // Inbound webhooks — generous, but not unlimited (guards a redelivery storm).
        RateLimiter::for('webhook', fn (Request $r) => [
            Limit::perMinute((int) config('ratelimits.webhook', 300))->by($r->ip()),
        ]);
    }
}
