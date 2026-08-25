<?php

namespace Tests\Feature\Growth;

use App\Contracts\PaymentGateway;
use App\Models\Booking;
use App\Models\Campaign;
use App\Models\Category;
use App\Models\ProviderAvailability;
use App\Models\ProviderProfile;
use App\Models\ProviderVerification;
use App\Models\Service;
use App\Models\User;
use App\Services\BookingService;
use App\Services\Growth\CampaignDiscountService;
use App\Services\Growth\PlacementService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Growth & Promotions — the customer checkout discount.
 *
 * The load-bearing guarantees: the PROVIDER IS PAID IN FULL, the budget cap is a
 * hard stop, per-user caps hold, apply is idempotent, promo codes validate
 * server-side, and pausing removes a campaign from the app immediately.
 */
class CampaignDiscountTest extends TestCase
{
    use RefreshDatabase;

    private User $buyer;
    private User $provider;
    private Category $category;

    /** Gateway spy. */
    public array $holds = [];

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        config(['lipila.enabled' => false]); // synchronous stub gateway path

        $this->app->instance(PaymentGateway::class, new class($this) implements PaymentGateway {
            public function __construct(private CampaignDiscountTest $test) {}
            public function holdFunds(string $payerPhone, float $amount, string $bookingId, float $commissionSplit, float $providerSplit): string
            {
                $ref = 'TEST-HOLD-' . count($this->test->holds) . '-' . $bookingId;
                $this->test->holds[] = ['amount' => $amount, 'commission' => $commissionSplit, 'provider' => $providerSplit, 'booking' => $bookingId];
                return $ref;
            }
            public function releaseFunds(string $holdRef, string $providerPhone, float $amount, string $bookingId): ?string { return 'TEST-PAYOUT'; }
            public function refund(string $holdRef, string $payerPhone, float $amount): ?string { return 'REF-' . Str::uuid(); }
            public function status(string $holdRef): array { return ['status' => 'HELD', 'amount' => 0.0, 'created_at' => now()->toIso8601String()]; }
        });

        $this->category = Category::create(['name' => 'Home', 'slug' => 'home', 'is_active' => true, 'risk_tier' => 1, 'display_order' => 1]);

        $this->provider = User::create(['legal_name' => 'Prov', 'email' => 'p@test.zm', 'phone' => '+260971111111', 'role' => 'PROVIDER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('t')]);
        ProviderProfile::create(['user_id' => $this->provider->id, 'trust_tier' => 2, 'accepting_bookings' => true, 'display_name' => 'Prov', 'momo_number' => $this->provider->phone]);
        foreach (['nrc', 'momo_name_match'] as $type) {
            ProviderVerification::create(['provider_id' => $this->provider->id, 'verification_type' => $type, 'status' => 'VERIFIED', 'verified_at' => now()]);
        }
        for ($day = 0; $day <= 6; $day++) {
            ProviderAvailability::create(['provider_id' => $this->provider->id, 'day_of_week' => $day, 'start_time' => '08:00', 'end_time' => '17:00', 'is_recurring' => true]);
        }

        $this->buyer = User::create(['legal_name' => 'Buyer', 'email' => 'b@test.zm', 'phone' => '+260972222222', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('t')]);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function makeService(): Service
    {
        return Service::create(['title' => 'Svc', 'category_id' => $this->category->id, 'status' => 'ACTIVE', 'provider_id' => $this->provider->id, 'pricing_model' => 'OUTCOME_FIXED', 'base_price' => 500]);
    }

    /** $slot spaces bookings 4h apart (10:00, 14:00, …) so they never overlap. */
    private function createBooking(Service $service, int $slot = 0): Booking
    {
        $start = Carbon::now('Africa/Lusaka')->next(Carbon::MONDAY)->setTime(10, 0)->addHours($slot * 4);
        return app(BookingService::class)->create($this->buyer, [
            'service_id' => $service->id, 'provider_id' => $this->provider->id,
            'scheduled_start' => $start->toIso8601String(),
            'delivery_lat' => -15.39, 'delivery_lng' => 28.32, 'channel' => 'APP',
        ]);
    }

    private function makeCampaign(array $overrides = []): Campaign
    {
        return Campaign::create(array_merge([
            'name' => 'Test', 'audience_type' => 'CUSTOMER', 'audience_filter' => 'ALL_CUSTOMERS',
            'offer_type' => 'AMOUNT_OFF', 'offer_value' => 100,
            'placements' => ['APP_CHECKOUT'], 'status' => 'LIVE',
            'start_at' => now()->subDay(), 'end_at' => now()->addDay(),
        ], $overrides));
    }

    private function asUser(User $user): array
    {
        return ['Authorization' => 'Bearer ' . auth('api')->login($user)];
    }

    // ── The core invariant: provider paid in full, customer pays less ────────

    public function test_customer_discount_reduces_customer_total_but_not_provider_payout(): void
    {
        $service = $this->makeService();
        $booking = $this->createBooking($service);
        $providerSplitBefore = (float) $booking->provider_split_zmw;
        $commissionBefore    = (float) $booking->commission_split_zmw;

        // A ZMW 50 discount is comfortably below the commission take, so we can
        // assert the take drops by exactly the discount (Sebenza absorbs it).
        $this->makeCampaign(['offer_type' => 'AMOUNT_OFF', 'offer_value' => 50]);

        $this->postJson("/api/bookings/{$booking->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $booking->refresh();

        // Customer charged 500 - 50 = 450. No protection fee is added on top
        // (removed 2026-08-24), so the discount is the ONLY adjustment.
        $this->assertEqualsWithDelta(450.0, $this->holds[0]['amount'], 0.01);
        // Provider split byte-for-byte unchanged — paid in full.
        $this->assertEqualsWithDelta($providerSplitBefore, (float) $booking->provider_split_zmw, 0.01);
        $this->assertEqualsWithDelta($providerSplitBefore, $this->holds[0]['provider'], 0.01);
        // Sebenza absorbs it: commission take drops by the discount.
        $this->assertEqualsWithDelta($commissionBefore - 50, (float) $booking->commission_split_zmw, 0.01);
        // Stamped on the booking + a ledger/spend row written atomically.
        $this->assertEqualsWithDelta(50.0, (float) $booking->campaign_discount_zmw, 0.01);
        $this->assertDatabaseHas('campaign_ledger_entries', ['booking_id' => $booking->id, 'kind' => 'CUSTOMER_DISCOUNT', 'amount_zmw' => 50]);
    }

    // ── Budget cap is a hard stop ────────────────────────────────────────────

    public function test_budget_cap_stops_the_campaign_mid_flight(): void
    {
        $service  = $this->makeService();
        $campaign = $this->makeCampaign(['offer_type' => 'AMOUNT_OFF', 'offer_value' => 100, 'budget_cap' => 100]);

        // First booking consumes the whole budget.
        $b1 = $this->createBooking($service, 0);
        $this->postJson("/api/bookings/{$b1->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $campaign->refresh();
        $this->assertEqualsWithDelta(100.0, (float) $campaign->budget_spent, 0.01);
        $this->assertSame('BUDGET_EXHAUSTED', $campaign->status);

        // Second booking gets no discount — the cap is never overspent.
        $b2 = $this->createBooking($service, 1);
        $this->postJson("/api/bookings/{$b2->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $b2->refresh();
        $this->assertEqualsWithDelta(0.0, (float) $b2->campaign_discount_zmw, 0.01);
        $campaign->refresh();
        $this->assertEqualsWithDelta(100.0, (float) $campaign->budget_spent, 0.01);
    }

    // ── Per-user cap ─────────────────────────────────────────────────────────

    public function test_per_user_cap_is_enforced(): void
    {
        $service = $this->makeService();
        $this->makeCampaign(['offer_type' => 'AMOUNT_OFF', 'offer_value' => 100, 'max_uses_per_user' => 1]);

        $b1 = $this->createBooking($service, 0);
        $this->postJson("/api/bookings/{$b1->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $b1->refresh();
        $this->assertEqualsWithDelta(100.0, (float) $b1->campaign_discount_zmw, 0.01);

        $b2 = $this->createBooking($service, 1);
        $this->postJson("/api/bookings/{$b2->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $b2->refresh();
        $this->assertEqualsWithDelta(0.0, (float) $b2->campaign_discount_zmw, 0.01);
    }

    // ── Idempotency: apply twice on one booking → one redemption ─────────────

    public function test_apply_is_idempotent(): void
    {
        $service  = $this->makeService();
        $booking  = $this->createBooking($service);
        $campaign = $this->makeCampaign(['offer_type' => 'AMOUNT_OFF', 'offer_value' => 100, 'budget_cap' => 1000]);

        $svc = app(CampaignDiscountService::class);
        $r1 = $svc->apply($booking, null, $this->buyer, false);
        $r2 = $svc->apply($booking, null, $this->buyer, false);

        $this->assertEqualsWithDelta(100.0, $r1['discount_zmw'], 0.01);
        $this->assertEqualsWithDelta(100.0, $r2['discount_zmw'], 0.01);
        $this->assertSame(1, \App\Models\CampaignLedgerEntry::where('booking_id', $booking->id)->count());
        $campaign->refresh();
        $this->assertEqualsWithDelta(100.0, (float) $campaign->budget_spent, 0.01); // decremented once
    }

    // ── Promo codes validate server-side ─────────────────────────────────────

    public function test_promo_code_validates_server_side(): void
    {
        $service = $this->makeService();
        $this->makeCampaign(['name' => 'Code', 'offer_type' => 'AMOUNT_OFF', 'offer_value' => 50, 'code' => 'SAVE50']);

        // Valid code applies.
        $b1 = $this->createBooking($service, 0);
        $this->postJson("/api/bookings/{$b1->id}/pay", ['promo_code' => 'SAVE50'], $this->asUser($this->buyer))->assertOk();
        $b1->refresh();
        $this->assertEqualsWithDelta(50.0, (float) $b1->campaign_discount_zmw, 0.01);

        // Unknown code is ignored — no discount, no error.
        $b2 = $this->createBooking($service, 1);
        $this->postJson("/api/bookings/{$b2->id}/pay", ['promo_code' => 'BOGUS'], $this->asUser($this->buyer))->assertOk();
        $b2->refresh();
        $this->assertEqualsWithDelta(0.0, (float) $b2->campaign_discount_zmw, 0.01);
    }

    // ── Eligibility: ineligible audience sees nothing ────────────────────────

    public function test_ineligible_user_gets_no_discount(): void
    {
        $service = $this->makeService();
        // NEW_CUSTOMERS only, but this buyer already has a completed booking.
        $past = Carbon::now('Africa/Lusaka')->subWeek()->setTime(10, 0);
        Booking::create([
            'buyer_id' => $this->buyer->id, 'provider_id' => $this->provider->id, 'service_id' => $service->id,
            'status' => 'COMPLETED', 'amount' => 100, 'payment_mode' => 'ESCROW',
            'scheduled_start' => $past->toIso8601String(), 'scheduled_end' => $past->copy()->addHour()->toIso8601String(),
        ]);
        $this->makeCampaign(['audience_filter' => 'NEW_CUSTOMERS', 'offer_type' => 'AMOUNT_OFF', 'offer_value' => 100]);

        $booking = $this->createBooking($service);
        $this->postJson("/api/bookings/{$booking->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $booking->refresh();
        $this->assertEqualsWithDelta(0.0, (float) $booking->campaign_discount_zmw, 0.01);
    }

    // ── Placement visibility: pausing removes it from the app ────────────────

    public function test_home_banner_placement_appears_live_and_vanishes_on_pause(): void
    {
        $campaign = $this->makeCampaign([
            'placements' => ['APP_HOME_BANNER'],
            'content' => ['title' => 'Big Sale', 'subtitle' => '20% off'],
        ]);

        $placements = app(PlacementService::class);
        $this->assertCount(1, $placements->homeBanners($this->buyer));

        $campaign->update(['status' => 'PAUSED']);
        $this->assertCount(0, $placements->homeBanners($this->buyer));
    }

    // ── Search badge only labels covered services, and only when eligible ────

    public function test_search_badge_resolves_for_eligible_category(): void
    {
        $this->makeCampaign([
            'placements' => ['APP_SEARCH_BADGE'],
            'audience_filter' => 'BY_CATEGORY',
            'audience_params' => ['category_ids' => [$this->category->id]],
            'offer_type' => 'PERCENT_OFF', 'offer_value' => 20,
        ]);

        $placements = app(PlacementService::class);
        $badge = $placements->badgeForService(['category_id' => $this->category->id, 'region' => null], $this->buyer);
        $this->assertNotNull($badge);
        $this->assertSame('20% off', $badge['label']);

        // A different category is not covered.
        $this->assertNull($placements->badgeForService(['category_id' => 999999, 'region' => null], $this->buyer));
    }
}
