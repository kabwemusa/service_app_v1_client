<?php

namespace Tests\Feature\Booking;

use App\Contracts\PaymentGateway;
use App\Models\Booking;
use App\Models\Category;
use App\Models\PaymentEvent;
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
 * Lipila keys everything on the merchant `referenceId` WE generate, so a callback
 * is linked to a booking purely through the reference we persisted at initiation
 * — escrow_hold_ref, payout_ref or refund_ref. Nothing in the payload asserts a
 * booking id, and nothing is trusted to.
 *
 * Payouts and refunds are the SAME Lipila primitive (an outbound disbursement)
 * and arrive on the same `"type": "Disbursement"` callback, so the reference is
 * also what tells them apart. That's covered here too.
 */
class LipilaWebhookLinkingTest extends TestCase
{
    use RefreshDatabase;

    /** Base64 of 32 bytes, exactly as the dashboard issues it. */
    private const WEBHOOK_SECRET = 'c2ViZW56YS10ZXN0LXNlY3JldC0zMi1ieXRlcy1rZXkh';

    private User $buyer;
    private User $provider;
    private Service $service;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        config([
            'lipila.webhook.secret'           => self::WEBHOOK_SECRET,
            'lipila.webhook.verify_signature' => true,
            'lipila.webhook.tolerance'        => 300,
        ]);

        // Keep this test hermetic — .env may have LIPILA_ENABLED=true, which would
        // otherwise bind the real gateway and hit the sandbox HTTP API. This
        // double is deliberately NOT a PaymentStatusVerifier, so the controller
        // falls back to the posted status instead of re-fetching over the wire.
        $this->app->bind(PaymentGateway::class, function () {
            return new class implements PaymentGateway {
                public function holdFunds(string $payerPhone, float $amount, string $bookingId, float $commissionSplit, float $providerSplit): string
                {
                    return 'sbz-dep-' . Str::uuid();
                }

                public function releaseFunds(string $holdRef, string $providerPhone, float $amount, string $bookingId): ?string
                {
                    return 'sbz-pay-' . Str::uuid();
                }

                public function refund(string $holdRef, string $payerPhone, float $amount): ?string
                {
                    return 'sbz-ref-' . Str::uuid();
                }

                public function status(string $holdRef): array
                {
                    return ['status' => 'HELD', 'amount' => 0.0, 'created_at' => now()->toIso8601String()];
                }
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

    /**
     * POST a callback exactly as Lipila does: a raw JSON body signed per the
     * Standard Webhooks spec — HMAC-SHA256 over `{id}.{timestamp}.{body}` under
     * the base64-DECODED secret, base64-encoded and prefixed `v1,`. The signature
     * MUST be computed over the same bytes we send, which is why the body is
     * built as a string here.
     */
    private function webhook(array $payload): \Illuminate\Testing\TestResponse
    {
        $body      = json_encode($payload);
        $id        = 'msg_' . Str::uuid();
        $timestamp = (string) time();
        $signature = 'v1,' . base64_encode(hash_hmac(
            'sha256',
            $id . '.' . $timestamp . '.' . $body,
            base64_decode(self::WEBHOOK_SECRET),
            true,
        ));

        return $this->call(
            'POST', '/api/webhooks/lipila', [], [], [],
            [
                'CONTENT_TYPE'           => 'application/json',
                'HTTP_WEBHOOK_ID'        => $id,
                'HTTP_WEBHOOK_TIMESTAMP' => $timestamp,
                'HTTP_WEBHOOK_SIGNATURE' => $signature,
            ],
            $body,
        );
    }

    public function test_collection_webhook_links_via_escrow_hold_ref(): void
    {
        $booking = $this->makeBooking();
        Booking::whereKey($booking->id)->update(['escrow_hold_ref' => 'sbz-dep-abc-123', 'status' => 'PENDING_PAYMENT']);

        $this->webhook([
            'referenceId'   => 'sbz-dep-abc-123',
            'type'          => 'Collection',
            'status'        => 'Successful',
            'amount'        => 500.00,
            'currency'      => 'ZMW',
            'accountNumber' => '260972222222',
            'paymentType'   => 'AirtelMoney',
            'identifier'    => 'LPLXC-20260823-0001',
            'externalId'    => 'MP260823.1252.C7324',
            'message'       => 'Transaction Successful',
        ])->assertOk();

        $this->assertSame('FUNDS_HELD', $booking->fresh()->status);

        $event = PaymentEvent::where('external_ref', 'sbz-dep-abc-123')->first();
        $this->assertNotNull($event);
        $this->assertSame($booking->id, $event->booking_id);
        $this->assertSame('collection', $event->type);
        $this->assertSame('lipila', $event->provider);
    }

    public function test_disbursement_webhook_links_via_payout_ref(): void
    {
        $booking = $this->makeBooking();
        Booking::whereKey($booking->id)->update([
            'escrow_hold_ref' => 'sbz-dep-xyz-999',
            'payout_ref'      => 'sbz-pay-abc-123',
            'status'          => 'DISBURSED',
            'disbursed_at'    => now(),
        ]);

        $this->webhook([
            'referenceId' => 'sbz-pay-abc-123',
            'type'        => 'Disbursement',
            'status'      => 'Successful',
            'amount'      => 450.00,
            'identifier'  => 'LPLXC-20260823-0002',
        ])->assertOk();

        $event = PaymentEvent::where('external_ref', 'sbz-pay-abc-123')->first();
        $this->assertNotNull($event);
        $this->assertSame($booking->id, $event->booking_id);
        $this->assertSame('payout', $event->type);
    }

    public function test_failed_disbursement_reverts_disbursed_booking_via_payout_ref(): void
    {
        $booking = $this->makeBooking();
        Booking::whereKey($booking->id)->update([
            'escrow_hold_ref' => 'sbz-dep-fail-1',
            'payout_ref'      => 'sbz-pay-fail-1',
            'status'          => 'DISBURSED',
            'disbursed_at'    => now(),
        ]);

        $this->webhook([
            'referenceId' => 'sbz-pay-fail-1',
            'type'        => 'Disbursement',
            'status'      => 'Failed',
            'message'     => 'Not enough funds',
        ])->assertOk();

        $fresh = $booking->fresh();
        $this->assertSame('COMPLETED', $fresh->status);
        $this->assertNull($fresh->disbursed_at);
    }

    /**
     * A refund rides the same `"type": "Disbursement"` callback as a payout. Only
     * the reference distinguishes them — a refund reference must NOT be mistaken
     * for a payout and drag the booking to DISBURSED.
     */
    public function test_disbursement_webhook_for_a_refund_reference_is_typed_as_a_refund(): void
    {
        $booking = $this->makeBooking();
        Booking::whereKey($booking->id)->update([
            'escrow_hold_ref' => 'sbz-dep-cancel-1',
            'refund_ref'      => 'sbz-ref-abc-123',
            'status'          => 'CANCELLED',
            'refunded_at'     => now(),
        ]);

        $this->webhook([
            'referenceId' => 'sbz-ref-abc-123',
            'type'        => 'Disbursement',
            'status'      => 'Successful',
            'amount'      => 500.00,
        ])->assertOk();

        $event = PaymentEvent::where('external_ref', 'sbz-ref-abc-123')->first();
        $this->assertNotNull($event);
        $this->assertSame('refund', $event->type);
        $this->assertSame($booking->id, $event->booking_id);

        $this->assertSame('CANCELLED', $booking->fresh()->status, 'a refund disbursement must not disburse the booking');
    }

    public function test_disburse_payout_persists_payout_ref(): void
    {
        $booking = $this->makeBooking();
        Booking::whereKey($booking->id)->update(['escrow_hold_ref' => 'sbz-dep-disburse-1', 'status' => 'COMPLETED']);

        app(BookingService::class)->disbursePayout($booking->fresh()->load('service', 'provider.providerProfile'));

        $fresh = $booking->fresh();
        $this->assertSame('DISBURSED', $fresh->status);
        $this->assertNotNull($fresh->payout_ref);
    }
}
