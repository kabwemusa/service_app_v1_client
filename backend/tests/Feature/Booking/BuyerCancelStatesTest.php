<?php

namespace Tests\Feature\Booking;

use App\Contracts\PaymentGateway;
use App\Exceptions\Api\ApiException;
use App\Models\Booking;
use App\Models\Category;
use App\Models\ProviderAvailability;
use App\Models\ProviderProfile;
use App\Models\ProviderVerification;
use App\Models\Service;
use App\Models\User;
use App\Services\BookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Which states a BUYER may cancel from.
 *
 * The guard in BookingService::cancel was a hand-maintained list that had
 * drifted from the state machine and omitted PENDING_PAYMENT and PAYMENT_FAILED
 * — trapping customers in a booking they could not leave even though no money
 * had settled and no work had started.
 *
 * It is also deliberately NARROWER than the machine: the machine permits
 * DISPUTED → CANCELLED for an admin resolving a dispute, but a buyer must not be
 * able to walk out of a dispute (and would get no refund if they could, since
 * DISPUTED is not a funds-held state). Both halves are pinned here.
 */
class BuyerCancelStatesTest extends TestCase
{
    use RefreshDatabase;

    public int $refundCalls = 0;

    private User $buyer;
    private User $provider;
    private Service $service;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        config()->set('lipila.enabled', false);

        $test = $this;
        $this->app->bind(PaymentGateway::class, fn () => new class($test) implements PaymentGateway {
            public function __construct(private BuyerCancelStatesTest $t) {}
            public function holdFunds(string $p, float $a, string $b, float $c, float $d): string { return 'HOLD-' . Str::uuid(); }
            public function releaseFunds(string $h, string $p, float $a, string $b): ?string { return 'PAY-' . Str::uuid(); }
            public function refund(string $h, string $p, float $a): ?string
            {
                $this->t->refundCalls++;
                return 'REF-' . Str::uuid();
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

    private function bookingInState(string $status, array $extra = []): Booking
    {
        $booking = new Booking();
        $booking->forceFill(array_merge([
            'buyer_id'        => $this->buyer->id,
            'provider_id'     => $this->provider->id,
            'service_id'      => $this->service->id,
            'amount'          => 500,
            'payment_mode'    => 'ESCROW',
            'status'          => $status,
            'escrow_phase'    => 'FULL',
            'scheduled_start' => now()->addDay(),
            'scheduled_end'   => now()->addDay()->addHour(),
        ], $extra))->save();

        return $booking;
    }

    /**
     * The bug: a customer whose MoMo prompt was never answered sat at
     * PENDING_PAYMENT and could not cancel. No money has settled here, so no
     * refund is issued either.
     */
    public function test_buyer_can_cancel_a_booking_awaiting_payment(): void
    {
        $booking = $this->bookingInState('PENDING_PAYMENT', ['escrow_hold_ref' => 'sbz-dep-pending-1']);

        app(BookingService::class)->cancel($booking->id, $this->buyer);

        $this->assertSame('CANCELLED', $booking->fresh()->status);
        $this->assertSame(0, $this->refundCalls, 'nothing settled, so nothing to refund');
        $this->assertNull($booking->fresh()->refunded_at);
    }

    /** Same for a payment that failed outright — the customer must be able to walk away. */
    public function test_buyer_can_cancel_after_a_failed_payment(): void
    {
        $booking = $this->bookingInState('PAYMENT_FAILED', ['escrow_hold_ref' => 'sbz-dep-failed-1']);

        app(BookingService::class)->cancel($booking->id, $this->buyer);

        $this->assertSame('CANCELLED', $booking->fresh()->status);
        $this->assertSame(0, $this->refundCalls);
    }

    /** Funded but not started: still cancellable, and this one DOES refund. */
    public function test_buyer_cancelling_a_funded_booking_still_refunds(): void
    {
        $booking = $this->bookingInState('FUNDS_HELD', ['escrow_hold_ref' => 'sbz-dep-held-1']);

        app(BookingService::class)->cancel($booking->id, $this->buyer);

        $fresh = $booking->fresh();
        $this->assertSame('CANCELLED', $fresh->status);
        $this->assertSame(1, $this->refundCalls, 'held funds must be returned');
        $this->assertNotNull($fresh->refunded_at);
        $this->assertNotNull($fresh->refund_ref);
    }

    /** Buyer authority ends when the provider starts work. */
    public function test_buyer_cannot_cancel_once_work_is_in_progress(): void
    {
        $booking = $this->bookingInState('IN_PROGRESS', ['escrow_hold_ref' => 'sbz-dep-live-1']);

        $this->expectException(ApiException::class);

        try {
            app(BookingService::class)->cancel($booking->id, $this->buyer);
        } finally {
            $this->assertSame('IN_PROGRESS', $booking->fresh()->status);
            $this->assertSame(0, $this->refundCalls);
        }
    }

    /**
     * The state machine allows DISPUTED → CANCELLED for an ADMIN resolving a
     * dispute. A buyer must not reach it: cancel() does not refund from DISPUTED,
     * so allowing it would cancel the booking and keep the customer's money.
     */
    public function test_buyer_cannot_cancel_out_of_a_dispute(): void
    {
        $booking = $this->bookingInState('DISPUTED', ['escrow_hold_ref' => 'sbz-dep-disputed-1']);

        $this->expectException(ApiException::class);

        try {
            app(BookingService::class)->cancel($booking->id, $this->buyer);
        } finally {
            $this->assertSame('DISPUTED', $booking->fresh()->status);
            $this->assertSame(0, $this->refundCalls);
        }
    }

    /** A double-tapped cancel must not issue two refunds. */
    public function test_double_cancel_refunds_once(): void
    {
        $booking = $this->bookingInState('FUNDS_HELD', ['escrow_hold_ref' => 'sbz-dep-double-1']);
        $service = app(BookingService::class);

        $service->cancel($booking->id, $this->buyer);
        try { $service->cancel($booking->id, $this->buyer); } catch (\Throwable) { /* expected */ }

        $this->assertSame(1, $this->refundCalls);
    }
}
