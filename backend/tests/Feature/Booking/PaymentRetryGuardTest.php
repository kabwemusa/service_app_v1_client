<?php

namespace Tests\Feature\Booking;

use App\Contracts\PaymentGateway;
use App\Contracts\PaymentStatusVerifier;
use App\Enums\ErrorCode;
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
use Tests\TestCase;

/**
 * TXN-2 — retrying payment while a collection is still outstanding.
 *
 * A second "Pay now" must never mint a competing charge. That guard was always
 * there, but it returned the booking unchanged: no log, no error, and a client
 * that could not tell "prompt resent" from "nothing happened". A customer whose
 * Airtel prompt hung in Pending kept tapping and concluded the app was broken.
 * It now refuses out loud.
 *
 * Critically, it must NOT auto-reissue after a timeout either: escrow_hold_ref
 * would move to the new reference and orphan the old one, and a completed orphan
 * is money we would silently keep.
 */
class PaymentRetryGuardTest extends TestCase
{
    use RefreshDatabase;

    /** What the fake gateway reports for the outstanding deposit. */
    public string $existingStatus = 'PENDING';
    public int $holdCalls = 0;

    private User $buyer;
    private User $provider;
    private Service $service;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        // The async branch is the one carrying the retry guard.
        config()->set('lipila.enabled', true);

        $test = $this;
        $this->app->bind(PaymentGateway::class, fn () => new class($test) implements PaymentGateway, PaymentStatusVerifier {
            public function __construct(private PaymentRetryGuardTest $t) {}

            public function holdFunds(string $p, float $a, string $b, float $c, float $d): string
            {
                $this->t->holdCalls++;
                return 'sbz-dep-fresh-' . $this->t->holdCalls;
            }

            public function releaseFunds(string $h, string $p, float $a, string $b): ?string { return 'PAY-1'; }
            public function refund(string $h, string $p, float $a): ?string { return 'REF-1'; }
            public function status(string $h): array { return ['status' => 'PENDING', 'amount' => 0.0, 'created_at' => '']; }
            public function verifyStatus(string $kind, string $ref): string { return $this->t->existingStatus; }
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

    private function awaitingPayment(string $ref = 'sbz-dep-outstanding-1'): Booking
    {
        $booking = new Booking();
        $booking->forceFill([
            'buyer_id'        => $this->buyer->id,
            'provider_id'     => $this->provider->id,
            'service_id'      => $this->service->id,
            'amount'          => 500,
            'payment_mode'    => 'ESCROW',
            'status'          => 'PENDING_PAYMENT',
            'escrow_phase'    => 'FULL',
            'escrow_hold_ref' => $ref,
            'scheduled_start' => now()->addDay(),
            'scheduled_end'   => now()->addDay()->addHour(),
        ])->save();

        return $booking;
    }

    /** The reported bug: retrying a hung prompt did nothing, silently. */
    public function test_retry_while_a_prompt_is_outstanding_is_refused_with_an_explanation(): void
    {
        $this->existingStatus = 'PENDING';
        $booking = $this->awaitingPayment();

        try {
            app(BookingService::class)->holdFunds($booking->id, $this->buyer);
            $this->fail('a retry over an outstanding prompt should be refused');
        } catch (ApiException $e) {
            $this->assertSame(ErrorCode::CONFLICT, $e->getErrorCode());
            $this->assertStringContainsString('already waiting on your phone', $e->getMessage());
        }

        $this->assertSame(0, $this->holdCalls, 'must never raise a competing charge');
        $this->assertSame('sbz-dep-outstanding-1', $booking->fresh()->escrow_hold_ref, 'the original reference must survive');
    }

    /** An unconfirmable status must also refuse — but say something different. */
    public function test_retry_is_refused_when_the_gateway_status_is_unknown(): void
    {
        $this->existingStatus = 'UNKNOWN';
        $booking = $this->awaitingPayment();

        try {
            app(BookingService::class)->holdFunds($booking->id, $this->buyer);
            $this->fail('an unverifiable outstanding collection should be refused');
        } catch (ApiException $e) {
            $this->assertSame(ErrorCode::CONFLICT, $e->getErrorCode());
            $this->assertStringContainsString("can't confirm", $e->getMessage());
        }

        $this->assertSame(0, $this->holdCalls);
    }

    /** A terminally failed collection IS retryable — that's the escape hatch. */
    public function test_retry_after_a_failed_collection_issues_a_fresh_hold(): void
    {
        $this->existingStatus = 'FAILED';
        $booking = $this->awaitingPayment();

        app(BookingService::class)->holdFunds($booking->id, $this->buyer);

        $this->assertSame(1, $this->holdCalls);
        $this->assertSame('sbz-dep-fresh-1', $booking->fresh()->escrow_hold_ref);
    }

    /** If the money already landed, advance rather than charging again. */
    public function test_retry_after_the_collection_completed_advances_the_booking(): void
    {
        $this->existingStatus = 'COMPLETED';
        $booking = $this->awaitingPayment();

        app(BookingService::class)->holdFunds($booking->id, $this->buyer);

        $this->assertSame(0, $this->holdCalls, 'already paid — never charge again');
        $this->assertSame('FUNDS_HELD', $booking->fresh()->status);
    }

    /**
     * A wedged prompt must not trap the customer: cancelling is the safe way out,
     * and it leaves the original reference on the booking so a late completion
     * can still be reconciled and refunded.
     */
    public function test_a_customer_stuck_behind_a_hung_prompt_can_still_cancel(): void
    {
        $this->existingStatus = 'PENDING';
        $booking = $this->awaitingPayment();

        app(BookingService::class)->cancel($booking->id, $this->buyer);

        $fresh = $booking->fresh();
        $this->assertSame('CANCELLED', $fresh->status);
        $this->assertSame(
            'sbz-dep-outstanding-1',
            $fresh->escrow_hold_ref,
            'the reference must be retained so a late completion is refundable',
        );
    }
}
