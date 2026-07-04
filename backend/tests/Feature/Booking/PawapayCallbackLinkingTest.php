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
 * PawaPay's sandbox echoes a single submitted metadata field back as a bare
 * {"value": "..."} object — dropping the field name entirely — instead of
 * the {key,value} shape we send. PawapayCallbackController must therefore
 * resolve bookings via the gateway references we persist ourselves
 * (escrow_hold_ref / payout_ref), never metadata alone. This locks in that
 * behaviour and the admin Escrow tab's linking of events to bookings.
 */
class PawapayCallbackLinkingTest extends TestCase
{
    use RefreshDatabase;

    private User $buyer;
    private User $provider;
    private Service $service;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        // Keep this test hermetic — .env has PAWAPAY_ENABLED=true, which
        // would otherwise bind the real gateway and hit the sandbox HTTP API.
        $this->app->bind(PaymentGateway::class, function () {
            return new class implements PaymentGateway {
                public function holdFunds(string $payerPhone, float $amount, string $bookingId, float $commissionSplit, float $providerSplit): string
                {
                    return 'TEST-HOLD-' . Str::uuid();
                }

                public function releaseFunds(string $holdRef, string $providerPhone, float $amount, string $bookingId): ?string
                {
                    return 'TEST-PAYOUT-' . Str::uuid();
                }

                public function refund(string $holdRef, string $payerPhone, float $amount): bool { return true; }
                public function status(string $holdRef): array { return ['status' => 'HELD', 'amount' => 0.0, 'created_at' => now()->toIso8601String()]; }
            };
        });

        $category = Category::create([
            'name' => 'Digital', 'slug' => 'digital', 'is_active' => true,
            'risk_tier' => 1, 'display_order' => 1,
        ]);

        $this->provider = User::create([
            'legal_name' => 'Provider One', 'email' => 'provider1@test.zm',
            'phone' => '+260971111111', 'role' => 'PROVIDER', 'account_state' => 'ACTIVE',
            'password_hash' => Hash::make('test'),
        ]);

        ProviderProfile::create([
            'user_id' => $this->provider->id, 'trust_tier' => 3,
            'accepting_bookings' => true, 'display_name' => 'Provider One',
            'momo_number' => $this->provider->phone,
        ]);

        foreach (['nrc', 'momo_name_match'] as $type) {
            ProviderVerification::create([
                'provider_id' => $this->provider->id, 'verification_type' => $type,
                'status' => 'VERIFIED', 'verified_at' => now(),
            ]);
        }

        for ($day = 0; $day <= 6; $day++) {
            ProviderAvailability::create([
                'provider_id' => $this->provider->id, 'day_of_week' => $day,
                'start_time' => '08:00', 'end_time' => '17:00', 'is_recurring' => true,
            ]);
        }

        $this->service = Service::create([
            'title' => 'Web Dev', 'category_id' => $category->id,
            'status' => 'ACTIVE', 'base_price' => 500, 'pricing_model' => 'OUTCOME_FIXED',
            'provider_id' => $this->provider->id,
        ]);

        $this->buyer = User::create([
            'legal_name' => 'Buyer One', 'email' => 'buyer1@test.zm',
            'phone' => '+260972222222', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE',
            'password_hash' => Hash::make('test'),
        ]);
    }

    private function makeBooking(): Booking
    {
        $start = Carbon::now('Africa/Lusaka')->next(Carbon::MONDAY)->setTime(10, 0);

        return app(BookingService::class)->create($this->buyer, [
            'service_id'      => $this->service->id,
            'provider_id'     => $this->provider->id,
            'scheduled_start' => $start->toIso8601String(),
            'scheduled_end'   => $start->copy()->addHour()->toIso8601String(),
            'delivery_lat'    => -15.39,
            'delivery_lng'    => 28.32,
            'channel'         => 'APP',
        ]);
    }

    /** The exact shape observed from pawaPay's sandbox: field name dropped entirely. */
    private function bareMetadata(): array
    {
        return ['value' => 'not-a-real-booking-id'];
    }

    public function test_deposit_callback_links_via_escrow_hold_ref_not_metadata(): void
    {
        $booking = $this->makeBooking();
        Booking::whereKey($booking->id)->update(['escrow_hold_ref' => 'dep-abc-123', 'status' => 'PENDING_PAYMENT']);

        $this->postJson('/api/pawapay/callback', [
            'depositId' => 'dep-abc-123',
            'status'    => 'COMPLETED',
            'amount'    => '500.00',
            'payer'     => ['accountDetails' => ['phoneNumber' => '260972222222', 'provider' => 'AIRTEL_OAPI_ZMB']],
            'metadata'  => $this->bareMetadata(),
        ])->assertOk();

        $this->assertSame('FUNDS_HELD', $booking->fresh()->status);

        $event = PawapayEvent::where('external_ref', 'dep-abc-123')->first();
        $this->assertNotNull($event);
        $this->assertSame($booking->id, $event->booking_id, 'event should link via escrow_hold_ref despite unusable metadata');
    }

    public function test_payout_callback_links_via_payout_ref_not_metadata(): void
    {
        $booking = $this->makeBooking();
        Booking::whereKey($booking->id)->update([
            'escrow_hold_ref' => 'dep-xyz-999',
            'payout_ref'      => 'payout-abc-123',
            'status'          => 'DISBURSED',
            'disbursed_at'    => now(),
        ]);

        $this->postJson('/api/pawapay/callback', [
            'payoutId' => 'payout-abc-123',
            'status'   => 'COMPLETED',
            'amount'   => '450.00',
            'metadata' => $this->bareMetadata(),
        ])->assertOk();

        $event = PawapayEvent::where('external_ref', 'payout-abc-123')->first();
        $this->assertNotNull($event);
        $this->assertSame($booking->id, $event->booking_id, 'event should link via payout_ref despite unusable metadata');
    }

    public function test_failed_payout_reverts_disbursed_booking_via_payout_ref(): void
    {
        $booking = $this->makeBooking();
        Booking::whereKey($booking->id)->update([
            'escrow_hold_ref' => 'dep-fail-1',
            'payout_ref'      => 'payout-fail-1',
            'status'          => 'DISBURSED',
            'disbursed_at'    => now(),
        ]);

        $this->postJson('/api/pawapay/callback', [
            'payoutId' => 'payout-fail-1',
            'status'   => 'FAILED',
            'metadata' => $this->bareMetadata(),
        ])->assertOk();

        $fresh = $booking->fresh();
        $this->assertSame('COMPLETED', $fresh->status);
        $this->assertNull($fresh->disbursed_at);
    }

    public function test_disburse_payout_persists_payout_ref(): void
    {
        $booking = $this->makeBooking();
        Booking::whereKey($booking->id)->update(['escrow_hold_ref' => 'dep-disburse-1', 'status' => 'COMPLETED']);

        app(BookingService::class)->disbursePayout($booking->fresh()->load('service', 'provider.providerProfile'));

        $fresh = $booking->fresh();
        $this->assertSame('DISBURSED', $fresh->status);
        $this->assertNotNull($fresh->payout_ref);
    }
}
