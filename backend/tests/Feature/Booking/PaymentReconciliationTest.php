<?php

namespace Tests\Feature\Booking;

use App\Contracts\PaymentGateway;
use App\Models\Booking;
use App\Models\Category;
use App\Models\PaymentReconciliation;
use App\Models\ProviderAvailability;
use App\Models\ProviderProfile;
use App\Models\ProviderVerification;
use App\Models\Service;
use App\Models\User;
use App\Services\BookingService;
use App\Services\PaymentReconciliationService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * § ERR-2 — a money-path external call that fails after local state was committed
 * must be durably queued and retried, not just logged. Here: a refund fails at
 * cancel time (booking still cancels), a reconciliation is recorded, and the
 * worker resolves it once the gateway recovers.
 */
class PaymentReconciliationTest extends TestCase
{
    use RefreshDatabase;

    /** Toggles the fake gateway's refund between failure and success. */
    public bool $refundWorks = false;
    public int $refundCalls = 0;

    private User $buyer;
    private User $provider;
    private Service $service;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        config()->set('pawapay.enabled', false);

        $test = $this;
        $this->app->bind(PaymentGateway::class, fn () => new class($test) implements PaymentGateway {
            public function __construct(private PaymentReconciliationTest $t) {}
            public function holdFunds(string $p, float $a, string $b, float $c, float $d): string { return 'HOLD-' . Str::uuid(); }
            public function releaseFunds(string $h, string $p, float $a, string $b): ?string { return 'PAY-' . Str::uuid(); }
            public function refund(string $h, string $p, float $a): bool {
                $this->t->refundCalls++;
                return $this->t->refundWorks;
            }
            public function status(string $h): array { return ['status' => 'HELD', 'amount' => 0.0, 'created_at' => now()->toIso8601String()]; }
        });

        $category = Category::create(['name' => 'Digital', 'slug' => 'digital', 'is_active' => true, 'risk_tier' => 1, 'display_order' => 1]);
        $this->provider = User::create(['legal_name' => 'Prov', 'phone' => '+260971111111', 'role' => 'PROVIDER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);
        ProviderProfile::create(['user_id' => $this->provider->id, 'trust_tier' => 3, 'accepting_bookings' => true, 'display_name' => 'Prov', 'momo_number' => $this->provider->phone]);
        foreach (['nrc', 'momo_name_match'] as $type) {
            ProviderVerification::create(['provider_id' => $this->provider->id, 'verification_type' => $type, 'status' => 'VERIFIED', 'verified_at' => now()]);
        }
        for ($day = 0; $day <= 6; $day++) {
            ProviderAvailability::create(['provider_id' => $this->provider->id, 'day_of_week' => $day, 'start_time' => '08:00', 'end_time' => '17:00', 'is_recurring' => true]);
        }
        $this->service = Service::create(['title' => 'Web', 'category_id' => $category->id, 'status' => 'ACTIVE', 'base_price' => 500, 'pricing_model' => 'OUTCOME_FIXED', 'provider_id' => $this->provider->id]);
        $this->buyer = User::create(['legal_name' => 'Buy', 'phone' => '+260972222222', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);
    }

    private function heldBooking(): Booking
    {
        $start = Carbon::now('Africa/Lusaka')->next(Carbon::MONDAY)->setTime(10, 0);
        $booking = app(BookingService::class)->create($this->buyer, [
            'service_id' => $this->service->id, 'provider_id' => $this->provider->id,
            'scheduled_start' => $start->toIso8601String(),
            'scheduled_end' => $start->copy()->addHour()->toIso8601String(),
            'delivery_lat' => -15.39, 'delivery_lng' => 28.32, 'channel' => 'APP',
        ]);
        Booking::whereKey($booking->id)->update(['status' => 'FUNDS_HELD', 'escrow_hold_ref' => 'dep-1', 'agreed_amount' => 500]);
        return $booking;
    }

    public function test_failed_refund_is_recorded_then_resolved_by_worker(): void
    {
        $booking = $this->heldBooking();

        // Refund fails at cancel time — the booking still cancels (state committed),
        // and the failure is queued for reconciliation, not lost.
        $this->refundWorks = false;
        app(BookingService::class)->cancel($booking->id, $this->buyer);

        $this->assertSame('CANCELLED', $booking->fresh()->status);
        $recon = PaymentReconciliation::where('booking_id', $booking->id)->first();
        $this->assertNotNull($recon);
        $this->assertSame(PaymentReconciliation::KIND_REFUND, $recon->kind);
        $this->assertSame(PaymentReconciliation::STATUS_PENDING, $recon->status);

        // Gateway recovers; the worker retries and resolves it.
        $this->refundWorks = true;
        PaymentReconciliation::whereKey($recon->id)->update(['next_attempt_at' => now()->subMinute()]);

        $result = app(PaymentReconciliationService::class)->retryDue();

        $this->assertSame(1, $result['resolved']);
        $this->assertSame(PaymentReconciliation::STATUS_RESOLVED, $recon->fresh()->status);
        $this->assertNotNull($recon->fresh()->resolved_at);
    }
}
