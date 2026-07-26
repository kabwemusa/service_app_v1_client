<?php

namespace Tests\Feature\Booking;

use App\Contracts\PaymentGateway;
use App\Models\Booking;
use App\Models\Category;
use App\Models\PawapayEvent;
use App\Models\ProviderAvailability;
use App\Models\ProviderProfile;
use App\Models\ProviderVerification;
use App\Models\Service;
use App\Models\User;
use App\Services\BookingService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase 2 — data-integrity & concurrency. Proves: no duplicate bookings on retry
 * (CON-1), a payout is disbursed at most once (TXN-1), a cancel refunds at most
 * once (TXN-3), and a redelivered deposit callback advances a booking once (TXN-5).
 */
class ConcurrencyIntegrityTest extends TestCase
{
    use RefreshDatabase;

    /** @var array<int,array{amount:float,booking:string}> */
    public array $releases = [];
    public array $refunds = [];

    private User $buyer;
    private User $provider;
    private Service $service;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        // Deterministic synchronous escrow (no async PawaPay HTTP) for the create path.
        config()->set('pawapay.enabled', false);

        $test = $this;
        $this->app->bind(PaymentGateway::class, fn () => new class($test) implements PaymentGateway {
            public function __construct(private ConcurrencyIntegrityTest $t) {}
            public function holdFunds(string $p, float $a, string $b, float $c, float $d): string { return 'HOLD-' . Str::uuid(); }
            public function releaseFunds(string $h, string $p, float $a, string $b): ?string {
                $this->t->releases[] = ['amount' => $a, 'booking' => $b];
                return 'PAY-' . Str::uuid();
            }
            public function refund(string $h, string $p, float $a): bool {
                $this->t->refunds[] = ['amount' => $a];
                return true;
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

    private function payload(array $extra = []): array
    {
        $start = Carbon::now('Africa/Lusaka')->next(Carbon::MONDAY)->setTime(10, 0);
        return array_merge([
            'service_id' => $this->service->id, 'provider_id' => $this->provider->id,
            'scheduled_start' => $start->toIso8601String(),
            'scheduled_end' => $start->copy()->addHour()->toIso8601String(),
            'delivery_lat' => -15.39, 'delivery_lng' => 28.32, 'channel' => 'APP',
        ], $extra);
    }

    public function test_same_idempotency_key_creates_one_booking(): void
    {
        $svc = app(BookingService::class);
        $a = $svc->create($this->buyer, $this->payload(['idempotency_key' => 'abc-123']));
        $b = $svc->create($this->buyer, $this->payload(['idempotency_key' => 'abc-123']));

        $this->assertSame($a->id, $b->id);
        $this->assertSame(1, Booking::where('buyer_id', $this->buyer->id)->count());
    }

    public function test_payout_is_disbursed_at_most_once(): void
    {
        $booking = app(BookingService::class)->create($this->buyer, $this->payload());
        Booking::whereKey($booking->id)->update(['status' => 'COMPLETED', 'escrow_hold_ref' => 'dep-1', 'provider_split_zmw' => 450]);

        $svc = app(BookingService::class);
        $svc->disbursePayout($booking->fresh()->load('service', 'provider.providerProfile'));
        // A second call (e.g. the due-payout batch racing the completion path).
        $svc->disbursePayout($booking->fresh()->load('service', 'provider.providerProfile'));

        $this->assertCount(1, $this->releases, 'releaseFunds must be called exactly once');
        $this->assertSame('DISBURSED', $booking->fresh()->status);
    }

    public function test_cancel_refunds_at_most_once(): void
    {
        $booking = app(BookingService::class)->create($this->buyer, $this->payload());
        Booking::whereKey($booking->id)->update(['status' => 'FUNDS_HELD', 'escrow_hold_ref' => 'dep-2', 'agreed_amount' => 500]);

        $svc = app(BookingService::class);
        $svc->cancel($booking->id, $this->buyer);

        // A second cancel is rejected (already cancelled) — no second refund.
        try { $svc->cancel($booking->id, $this->buyer); } catch (\Throwable $e) { /* expected */ }

        $this->assertCount(1, $this->refunds, 'refund must be issued exactly once');
        $this->assertSame('CANCELLED', $booking->fresh()->status);
        $this->assertNotNull($booking->fresh()->refunded_at);
    }

    public function test_redelivered_deposit_callback_advances_once(): void
    {
        $booking = app(BookingService::class)->create($this->buyer, $this->payload());
        Booking::whereKey($booking->id)->update(['status' => 'PENDING_PAYMENT', 'escrow_hold_ref' => 'dep-3', 'escrow_phase' => 'FULL']);

        $payload = ['depositId' => 'dep-3', 'status' => 'COMPLETED', 'amount' => '500.00'];
        $this->postJson('/api/pawapay/callback', $payload)->assertOk();
        // Redelivery.
        $this->postJson('/api/pawapay/callback', $payload)->assertOk();

        $this->assertSame('FUNDS_HELD', $booking->fresh()->status);
        // The redelivered event row is de-duped by the unique (ref,status) index.
        $this->assertSame(1, PawapayEvent::where('external_ref', 'dep-3')->where('pawapay_status', 'COMPLETED')->count());
    }
}
