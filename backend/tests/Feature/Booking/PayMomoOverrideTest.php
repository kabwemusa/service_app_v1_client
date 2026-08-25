<?php

namespace Tests\Feature\Booking;

use App\Contracts\PaymentGateway;
use App\Contracts\PaymentStatusVerifier;
use App\Models\Category;
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
 * Covers the "pay & hold funds" alternate-wallet flow: a buyer can send the
 * Mobile Money collection request to a different number than their account
 * phone (mirrors the WhatsApp "use another number" retry path).
 */
class PayMomoOverrideTest extends TestCase
{
    use RefreshDatabase;

    private User $buyer;
    private User $provider;
    private Service $service;

    /** Captures the phone number actually handed to the gateway. */
    public ?string $capturedPhone = null;

    /** How many collections the gateway was actually asked to raise. */
    public int $holdCalls = 0;

    /**
     * What the gateway reports for an ALREADY-OUTSTANDING collection.
     *
     * Only the PENDING_PAYMENT retry branch consults this. FAILED is the
     * realistic default for the resend case — the first prompt went unanswered
     * and timed out, which is precisely when a customer taps pay again.
     */
    public string $existingStatus = 'FAILED';

    protected function setUp(): void
    {
        parent::setUp();

        // The sync queue driver ignores ->delay(), so ExpireBookingJob would
        // otherwise run inline and immediately expire the freshly-created
        // REQUESTED booking before the test gets to call /pay.
        Queue::fake();

        $this->app->bind(PaymentGateway::class, function () {
            return new class($this) implements PaymentGateway, PaymentStatusVerifier {
                public function __construct(private PayMomoOverrideTest $test) {}

                public function holdFunds(string $payerPhone, float $amount, string $bookingId, float $commissionSplit, float $providerSplit): string
                {
                    $this->test->capturedPhone = $payerPhone;
                    $this->test->holdCalls++;
                    return 'TEST-HOLD-' . $this->test->holdCalls . '-' . $bookingId;
                }

                public function releaseFunds(string $holdRef, string $providerPhone, float $amount, string $bookingId): ?string { return 'TEST-PAYOUT-' . $bookingId; }
                public function refund(string $holdRef, string $payerPhone, float $amount): ?string { return 'REF-' . Str::uuid(); }
                public function status(string $holdRef): array { return ['status' => 'HELD', 'amount' => 0.0, 'created_at' => now()->toIso8601String()]; }
                public function verifyStatus(string $kind, string $ref): string { return $this->test->existingStatus; }
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
            'user_id' => $this->provider->id, 'trust_tier' => 2,
            'accepting_bookings' => true, 'display_name' => 'Provider One',
            'momo_number' => $this->provider->phone,
        ]);

        ProviderVerification::create([
            'provider_id' => $this->provider->id, 'verification_type' => 'nrc',
            'status' => 'VERIFIED', 'verified_at' => now(),
        ]);
        ProviderVerification::create([
            'provider_id' => $this->provider->id, 'verification_type' => 'momo_name_match',
            'status' => 'VERIFIED', 'verified_at' => now(),
        ]);

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

    private function makeBooking(): string
    {
        $start = Carbon::now('Africa/Lusaka')->next(Carbon::MONDAY)->setTime(10, 0);

        $booking = app(BookingService::class)->create($this->buyer, [
            'service_id'      => $this->service->id,
            'provider_id'     => $this->provider->id,
            'scheduled_start' => $start->toIso8601String(),
            'scheduled_end'   => $start->copy()->addHour()->toIso8601String(),
            'delivery_lat'    => -15.39,
            'delivery_lng'    => 28.32,
            'channel'         => 'APP',
        ]);

        return $booking->id;
    }

    private function asBuyer(): array
    {
        $token = auth('api')->login($this->buyer);
        return ['Authorization' => "Bearer {$token}"];
    }

    public function test_pay_without_override_charges_account_phone(): void
    {
        $id = $this->makeBooking();

        $this->postJson("/api/bookings/{$id}/pay", [], $this->asBuyer())->assertOk();

        $this->assertSame('+260972222222', $this->capturedPhone);
    }

    public function test_pay_with_valid_override_charges_the_given_number(): void
    {
        $id = $this->makeBooking();

        $this->postJson("/api/bookings/{$id}/pay", ['momo_number' => '0977654321'], $this->asBuyer())
            ->assertOk();

        $this->assertSame('+260977654321', $this->capturedPhone);
    }

    public function test_pay_rejects_an_invalid_momo_number(): void
    {
        $id = $this->makeBooking();

        $this->postJson("/api/bookings/{$id}/pay", ['momo_number' => '12345'], $this->asBuyer())
            ->assertStatus(422);

        $this->assertNull($this->capturedPhone);
    }

    /**
     * "Resend payment prompt" — the booking is already PENDING_PAYMENT because
     * the first MoMo prompt went unanswered and timed out, and the buyer taps
     * pay again. This must succeed as a retry, not be rejected as an illegal
     * PENDING_PAYMENT → PENDING_PAYMENT transition.
     */
    public function test_resend_after_a_failed_prompt_issues_a_fresh_collection(): void
    {
        config(['lipila.enabled' => true]);
        $this->existingStatus = 'FAILED'; // the first prompt timed out

        $id = $this->makeBooking();

        $this->postJson("/api/bookings/{$id}/pay", [], $this->asBuyer())->assertOk();
        $this->assertSame('PENDING_PAYMENT', \App\Models\Booking::find($id)->status);

        // Resend — same status, must not throw "Cannot transition from
        // PENDING_PAYMENT to PENDING_PAYMENT".
        $this->postJson("/api/bookings/{$id}/pay", [], $this->asBuyer())->assertOk();
        $this->assertSame('PENDING_PAYMENT', \App\Models\Booking::find($id)->status);
        $this->assertSame(2, $this->holdCalls, 'a resend over a dead prompt must raise a new collection');
    }

    /**
     * The other half: while the first prompt is STILL LIVE, a resend must be
     * refused rather than raising a competing charge.
     *
     * This case used to return 200 having done nothing at all, which is how a
     * customer with a hung Airtel prompt ended up tapping pay repeatedly and
     * concluding the app was broken. Full coverage lives in
     * PaymentRetryGuardTest; it is pinned here too because this is the endpoint
     * the "use another number" retry goes through — a different wallet is still
     * not a licence to double-charge.
     */
    public function test_resend_while_the_first_prompt_is_still_live_is_refused(): void
    {
        config(['lipila.enabled' => true]);

        $id = $this->makeBooking();

        $this->existingStatus = 'FAILED';
        $this->postJson("/api/bookings/{$id}/pay", [], $this->asBuyer())->assertOk();

        // The prompt is now genuinely outstanding on the handset.
        $this->existingStatus = 'PENDING';
        $this->postJson("/api/bookings/{$id}/pay", ['momo_number' => '260971234567'], $this->asBuyer())
            ->assertStatus(409);

        $this->assertSame(1, $this->holdCalls, 'no competing charge, even with a different wallet');
        $this->assertSame('PENDING_PAYMENT', \App\Models\Booking::find($id)->status);
    }
}
