<?php

namespace Tests\Feature\Booking;

use App\Contracts\PaymentGateway;
use App\Models\Booking;
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
use Tests\TestCase;

/**
 * Outcome-based pricing — all four models end-to-end:
 *
 *   OUTCOME_FIXED  — fixed price held at booking, released on completion
 *   HOURLY_CAPPED  — cap held; provider logs actual time; difference refunded
 *   PROVIDER_SCOPE — brief → scoped quote → approval → escrow (never before)
 *   QUOTE_DEPOSIT  — deposit at confirm; balance collected at completion (two-phase)
 *
 * Plus the payout repairs: auto-complete runs the full completion money flow,
 * and quote/completion keep the commission/payout split in sync with the
 * final gross.
 */
class OutcomeBasedPricingTest extends TestCase
{
    use RefreshDatabase;

    private User $buyer;
    private User $provider;
    private Category $category;

    /** Gateway spy — every hold / refund / release the flow makes. */
    public array $holds = [];
    public array $refunds = [];
    public array $releases = [];

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();

        // Synchronous gateway path (the spy below confirms holds inline).
        // The async Lipila path is covered by LipilaWebhookLinkingTest.
        config(['lipila.enabled' => false]);

        $this->app->instance(PaymentGateway::class, new class($this) implements PaymentGateway {
            public function __construct(private OutcomeBasedPricingTest $test) {}

            public function holdFunds(string $payerPhone, float $amount, string $bookingId, float $commissionSplit, float $providerSplit): string
            {
                $ref = 'TEST-HOLD-' . count($this->test->holds) . '-' . $bookingId;
                $this->test->holds[] = ['amount' => $amount, 'booking' => $bookingId, 'ref' => $ref];
                return $ref;
            }

            public function releaseFunds(string $holdRef, string $providerPhone, float $amount, string $bookingId): ?string
            {
                $this->test->releases[] = ['amount' => $amount, 'booking' => $bookingId, 'holdRef' => $holdRef];
                return 'TEST-PAYOUT-' . $bookingId;
            }

            public function refund(string $holdRef, string $payerPhone, float $amount): ?string
            {
                $this->test->refunds[] = ['amount' => $amount, 'holdRef' => $holdRef];
                return 'TEST-REFUND-' . $holdRef;
            }

            public function status(string $holdRef): array
            {
                return ['status' => 'HELD', 'amount' => 0.0, 'created_at' => now()->toIso8601String()];
            }
        });

        $this->category = Category::create([
            'name' => 'Home', 'slug' => 'home', 'is_active' => true,
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

        $this->buyer = User::create([
            'legal_name' => 'Buyer One', 'email' => 'buyer1@test.zm',
            'phone' => '+260972222222', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE',
            'password_hash' => Hash::make('test'),
        ]);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function makeService(array $overrides = []): Service
    {
        return Service::create(array_merge([
            'title'         => 'Test Service',
            'category_id'   => $this->category->id,
            'status'        => 'ACTIVE',
            'provider_id'   => $this->provider->id,
            'pricing_model' => 'OUTCOME_FIXED',
            'base_price'    => 500,
        ], $overrides));
    }

    private function createBooking(Service $service, array $extra = []): Booking
    {
        $start = Carbon::now('Africa/Lusaka')->next(Carbon::MONDAY)->setTime(10, 0);

        return app(BookingService::class)->create($this->buyer, array_merge([
            'service_id'      => $service->id,
            'provider_id'     => $this->provider->id,
            'scheduled_start' => $start->toIso8601String(),
            'delivery_lat'    => -15.39,
            'delivery_lng'    => 28.32,
            'channel'         => 'APP',
        ], $extra));
    }

    private function asUser(User $user): array
    {
        $token = auth('api')->login($user);
        return ['Authorization' => "Bearer {$token}"];
    }

    // ── OUTCOME_FIXED ────────────────────────────────────────────────────────

    public function test_outcome_fixed_end_to_end_hold_release(): void
    {
        $service = $this->makeService();
        $booking = $this->createBooking($service);

        $this->assertSame('REQUESTED', $booking->status);
        $this->assertEquals(500.0, (float) $booking->amount);

        // Escrow hold at booking (stub gateway = synchronous FUNDS_HELD).
        $this->postJson("/api/bookings/{$booking->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $booking->refresh();
        $this->assertSame('FUNDS_HELD', $booking->status);
        $this->assertSame('FULL', $booking->escrow_phase);
        // Held = exactly the quoted amount. The buyer-protection fee was removed
        // (2026-08-24), so nothing is added on top of the price the customer saw.
        $this->assertEqualsWithDelta(500.0, $this->holds[0]['amount'], 0.01);

        $this->postJson("/api/bookings/{$booking->id}/start", [], $this->asUser($this->provider))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/deliver", [], $this->asUser($this->provider))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/complete", [], $this->asUser($this->buyer))->assertOk();

        $booking->refresh();
        $this->assertSame('COMPLETED', $booking->status);
        $this->assertNotNull($booking->payout_eligible_at);
        $this->assertDatabaseHas('commissions', [
            'booking_id' => $booking->id, 'collection_status' => 'COLLECTED',
        ]);

        // Payout hold lapses → batch disburses exactly the provider split.
        $booking->update(['payout_eligible_at' => now()->subMinute()]);
        app(BookingService::class)->processDuePayouts();

        $booking->refresh();
        $this->assertSame('DISBURSED', $booking->status);
        $this->assertCount(1, $this->releases);
        $this->assertEqualsWithDelta((float) $booking->provider_split_zmw, $this->releases[0]['amount'], 0.01);
    }

    // ── HOURLY_CAPPED ────────────────────────────────────────────────────────

    public function test_hourly_capped_holds_cap_charges_actual_and_refunds_difference(): void
    {
        $service = $this->makeService([
            'pricing_model' => 'HOURLY_CAPPED',
            'base_price'    => 400,
            'hourly_rate'   => 100,
            'minimum_hours' => 1,
            'cap_hours'     => 4,
            'cap_amount'    => 400,
        ]);

        $booking = $this->createBooking($service);
        // The CAP is the booking amount — never a customer-hours computation.
        $this->assertEquals(400.0, (float) $booking->amount);
        // scheduled_end derived from cap hours (guide only, no customer input).
        $this->assertEquals(4 * 60, $booking->scheduled_start->diffInMinutes($booking->scheduled_end));

        $this->postJson("/api/bookings/{$booking->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $this->assertEqualsWithDelta(400.0, $this->holds[0]['amount'], 0.01); // the cap, nothing added

        // START: server records job_started_at. No hours are ever entered.
        $this->postJson("/api/bookings/{$booking->id}/start", [], $this->asUser($this->provider))->assertOk();
        $this->assertNotNull($booking->fresh()->job_started_at);

        // Finishing without a started timer is impossible here (already started).
        // Work for 2 h 20 min → rounds UP to the 30-min increment = 2.5 h = 250.
        $this->travelTo(now()->addMinutes(140));
        $this->postJson("/api/bookings/{$booking->id}/deliver", [], $this->asUser($this->provider))->assertOk();
        $this->travelBack();

        $booking->refresh();
        // Elapsed is server-computed from the two timestamps — never a self-report.
        $this->assertEqualsWithDelta(140, (int) $booking->observed_minutes, 1);
        $this->assertEquals(250.0, (float) $booking->final_charge_zmw);
        $this->assertNull($booking->actual_hours_logged); // deprecated — never written

        $this->postJson("/api/bookings/{$booking->id}/complete", [], $this->asUser($this->buyer))->assertOk();
        $booking->refresh();

        // Settled on the actual charge; the unused cap goes back to the customer.
        $this->assertSame('COMPLETED', $booking->status);
        $this->assertEquals(250.0, (float) $booking->agreed_amount);
        $this->assertCount(1, $this->refunds);
        $this->assertEqualsWithDelta(150.0, $this->refunds[0]['amount'], 0.01);
        $this->assertDatabaseHas('commissions', ['booking_id' => $booking->id, 'gross_amount' => 250.00]);

        // Payout releases the split of the ACTUAL charge, not the cap.
        $booking->update(['payout_eligible_at' => now()->subMinute()]);
        app(BookingService::class)->processDuePayouts();
        $this->assertEqualsWithDelta((float) $booking->fresh()->provider_split_zmw, $this->releases[0]['amount'], 0.01);
        $this->assertLessThan(400.0, $this->releases[0]['amount']);
    }

    public function test_hourly_capped_minimum_hours_enforced_on_charge(): void
    {
        $service = $this->makeService([
            'pricing_model' => 'HOURLY_CAPPED',
            'base_price'    => 400,
            'hourly_rate'   => 100,
            'minimum_hours' => 2,
            'cap_hours'     => 4,
            'cap_amount'    => 400,
        ]);

        $booking = $this->createBooking($service);
        $this->postJson("/api/bookings/{$booking->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/start", [], $this->asUser($this->provider))->assertOk();

        // 0.5 h observed, but the 2-hr minimum bills 200.
        $this->travelTo(now()->addMinutes(30));
        $this->postJson("/api/bookings/{$booking->id}/deliver", [], $this->asUser($this->provider))->assertOk();
        $this->travelBack();
        $this->assertEquals(200.0, (float) $booking->fresh()->final_charge_zmw);
    }

    public function test_hourly_capped_wraps_at_cap_when_timer_exceeds_it(): void
    {
        $service = $this->makeService([
            'pricing_model' => 'HOURLY_CAPPED',
            'base_price'    => 400,
            'hourly_rate'   => 100,
            'minimum_hours' => 1,
            'cap_hours'     => 4,
            'cap_amount'    => 400,
        ]);

        $booking = $this->createBooking($service);
        $this->postJson("/api/bookings/{$booking->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/start", [], $this->asUser($this->provider))->assertOk();

        // Runs 5 h — beyond the 4 h cap. Without a customer-approved extension the
        // charge WRAPS AT THE CAP; it is never silently exceeded.
        $this->travelTo(now()->addMinutes(300));
        $this->postJson("/api/bookings/{$booking->id}/deliver", [], $this->asUser($this->provider))->assertOk();
        $this->travelBack();

        $this->assertEquals(400.0, (float) $booking->fresh()->final_charge_zmw);
    }

    public function test_hourly_capped_customer_extension_raises_cap(): void
    {
        $service = $this->makeService([
            'pricing_model' => 'HOURLY_CAPPED',
            'base_price'    => 400,
            'hourly_rate'   => 100,
            'minimum_hours' => 1,
            'cap_hours'     => 4,
            'cap_amount'    => 400,
        ]);

        $booking = $this->createBooking($service);
        $this->postJson("/api/bookings/{$booking->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/start", [], $this->asUser($this->provider))->assertOk();

        // Provider requests, customer approves +2 h → additional 200 hold; cap → 600.
        $this->postJson("/api/bookings/{$booking->id}/request-cap-extension", [], $this->asUser($this->provider))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/approve-cap-extension", ['additional_hours' => 2], $this->asUser($this->buyer))->assertOk();
        $booking->refresh();
        $this->assertEquals(600.0, (float) $booking->agreed_amount);

        // Now 5 h is billable (≤ raised cap of 6 h) → 500.
        $this->travelTo(now()->addMinutes(300));
        $this->postJson("/api/bookings/{$booking->id}/deliver", [], $this->asUser($this->provider))->assertOk();
        $this->travelBack();
        $this->assertEquals(500.0, (float) $booking->fresh()->final_charge_zmw);
    }

    // ── PROVIDER_SCOPE ───────────────────────────────────────────────────────

    public function test_provider_scope_brief_quote_approve_flow(): void
    {
        $service = $this->makeService([
            'pricing_model' => 'PROVIDER_SCOPE',
            'base_price'    => null,
            'hourly_rate'   => 80,
            'scope_prompts' => ['How many bedrooms?', 'Any pets?'],
        ]);

        $booking = $this->createBooking($service, [
            'scope_brief' => [
                ['question' => 'How many bedrooms?', 'answer' => '3'],
                ['question' => 'Any pets?',          'answer' => 'One dog'],
            ],
        ]);

        // Brief captured, no price, no money movable.
        $this->assertSame('SCOPE_PENDING', $booking->status);
        $this->assertEquals(0.0, (float) $booking->amount);
        $this->assertCount(2, $booking->scope_brief);

        // Paying before a quote is approved must be impossible.
        $this->postJson("/api/bookings/{$booking->id}/pay", [], $this->asUser($this->buyer))->assertStatus(422);
        $this->assertCount(0, $this->holds);

        // Provider sends the scoped quote: price + duration + inclusions.
        $this->postJson("/api/bookings/{$booking->id}/quote", [
            'quoted_amount' => 300,
            'duration_mins' => 120,
            'inclusions'    => ['All rooms', 'Windows'],
            'message'       => 'Includes materials',
        ], $this->asUser($this->provider))->assertOk();

        $booking->refresh();
        $this->assertSame('QUOTE_SENT', $booking->status);
        $this->assertEquals(300.0, (float) $booking->agreed_amount);
        $this->assertSame('Includes materials', $booking->provider_quote['message']);
        $this->assertSame(['All rooms', 'Windows'], $booking->provider_quote['inclusions']);
        // Split recomputed for the quoted gross — the payout must match it.
        $this->assertGreaterThan(0, (float) $booking->provider_split_zmw);
        // Buyer-protection fee removed — a quote now carries no add-on.
        $this->assertSame(0.0, (float) $booking->buyer_protection_fee);

        // Customer approves → escrow holds ONLY now.
        $this->postJson("/api/bookings/{$booking->id}/approve-quote", [], $this->asUser($this->buyer))->assertOk();
        $booking->refresh();
        $this->assertSame('FUNDS_HELD', $booking->status);
        $this->assertCount(1, $this->holds);
        $this->assertEqualsWithDelta(300 + (float) $booking->buyer_protection_fee, $this->holds[0]['amount'], 0.01);
    }

    public function test_provider_scope_customer_can_decline_quote_without_charge(): void
    {
        $service = $this->makeService([
            'pricing_model' => 'PROVIDER_SCOPE', 'base_price' => null, 'hourly_rate' => 80,
        ]);

        $booking = $this->createBooking($service, [
            'scope_brief' => [['question' => 'What needs doing?', 'answer' => 'Deep clean']],
        ]);

        $this->postJson("/api/bookings/{$booking->id}/quote", ['quoted_amount' => 250], $this->asUser($this->provider))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/decline-quote", [], $this->asUser($this->buyer))->assertOk();

        $this->assertSame('CANCELLED', $booking->fresh()->status);
        $this->assertCount(0, $this->holds);
        $this->assertCount(0, $this->refunds);
    }

    // ── QUOTE_DEPOSIT ────────────────────────────────────────────────────────

    public function test_quote_deposit_two_phase_escrow(): void
    {
        $service = $this->makeService([
            'pricing_model'   => 'QUOTE_DEPOSIT',
            'base_price'      => null,
            'deposit_percent' => 30,
        ]);

        $booking = $this->createBooking($service, [
            'scope_brief' => [['question' => 'Describe the job', 'answer' => 'Full house repaint']],
        ]);
        $this->assertSame('SCOPE_PENDING', $booking->status);

        // Full quote after the brief → fixed deposit/balance split.
        $this->postJson("/api/bookings/{$booking->id}/quote", ['quoted_amount' => 1000], $this->asUser($this->provider))->assertOk();
        $booking->refresh();
        $this->assertSame('QUOTE_SENT', $booking->status);
        $this->assertEquals(300.0, (float) $booking->deposit_amount);
        $this->assertEquals(700.0, (float) $booking->balance_amount);

        // Approval holds ONLY the deposit.
        $this->postJson("/api/bookings/{$booking->id}/approve-quote", [], $this->asUser($this->buyer))->assertOk();
        $booking->refresh();
        $this->assertSame('DEPOSIT_HELD', $booking->status);
        $this->assertSame('DEPOSIT', $booking->escrow_phase);
        $this->assertEqualsWithDelta(300 + (float) $booking->buyer_protection_fee, $this->holds[0]['amount'], 0.01);

        $this->postJson("/api/bookings/{$booking->id}/start", [], $this->asUser($this->provider))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/deliver", [], $this->asUser($this->provider))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/complete", [], $this->asUser($this->buyer))->assertOk();

        $booking->refresh();
        $this->assertSame('COMPLETED', $booking->status);
        // Second collection against the same booking reference for the balance.
        $this->assertCount(2, $this->holds);
        $this->assertEqualsWithDelta(700.0, $this->holds[1]['amount'], 0.01);
        $this->assertNotNull($booking->balance_hold_ref);
        $this->assertSame('FULL', $booking->escrow_phase); // stub confirms inline

        // Both collections custodied → payout releases the full split.
        $booking->update(['payout_eligible_at' => now()->subMinute()]);
        app(BookingService::class)->processDuePayouts();
        $this->assertSame('DISBURSED', $booking->fresh()->status);
        $this->assertCount(1, $this->releases);
    }

    public function test_quote_deposit_payout_gated_until_balance_collected(): void
    {
        $service = $this->makeService([
            'pricing_model' => 'QUOTE_DEPOSIT', 'base_price' => null, 'deposit_percent' => 30,
        ]);
        $booking = $this->createBooking($service, [
            'scope_brief' => [['question' => 'Describe the job', 'answer' => 'Repaint']],
        ]);
        $this->postJson("/api/bookings/{$booking->id}/quote", ['quoted_amount' => 1000], $this->asUser($this->provider))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/approve-quote", [], $this->asUser($this->buyer))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/start", [], $this->asUser($this->provider))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/deliver", [], $this->asUser($this->provider))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/complete", [], $this->asUser($this->buyer))->assertOk();

        // Simulate the async gateway: balance still in-flight (BALANCE phase).
        $booking->refresh();
        $booking->update(['escrow_phase' => 'BALANCE', 'payout_eligible_at' => now()->subMinute()]);

        app(BookingService::class)->processDuePayouts();

        // No release while the balance is not custodied.
        $this->assertSame('COMPLETED', $booking->fresh()->status);
        $this->assertCount(0, $this->releases);

        // Balance lands (callback would set FULL) → payout proceeds.
        $booking->update(['escrow_phase' => 'FULL']);
        app(BookingService::class)->processDuePayouts();
        $this->assertSame('DISBURSED', $booking->fresh()->status);
        $this->assertCount(1, $this->releases);
    }

    // ── Payout repair: auto-complete runs the full money flow ────────────────

    public function test_auto_complete_worker_records_commission_and_schedules_payout(): void
    {
        $service = $this->makeService();
        $booking = $this->createBooking($service);

        $this->postJson("/api/bookings/{$booking->id}/pay", [], $this->asUser($this->buyer))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/start", [], $this->asUser($this->provider))->assertOk();
        $this->postJson("/api/bookings/{$booking->id}/deliver", [], $this->asUser($this->provider))->assertOk();

        // Customer never confirms; the dispute window lapses.
        Booking::where('id', $booking->id)->update(['updated_at' => now()->subHours(72)]);

        $this->artisan('escrow:auto-complete')->assertSuccessful();

        $booking->refresh();
        $this->assertSame('COMPLETED', $booking->status);
        // The old worker left payout_eligible_at NULL and recorded no commission
        // — the payout batch never picked these up. Both must now be present.
        $this->assertNotNull($booking->payout_eligible_at);
        $this->assertDatabaseHas('commissions', [
            'booking_id' => $booking->id, 'collection_status' => 'COLLECTED',
        ]);

        $booking->update(['payout_eligible_at' => now()->subMinute()]);
        app(BookingService::class)->processDuePayouts();
        $this->assertSame('DISBURSED', $booking->fresh()->status);
    }
}
