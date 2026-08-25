<?php

namespace Tests\Feature\Security;

use App\Contracts\PaymentGateway;
use App\Contracts\PaymentStatusVerifier;
use App\Models\Booking;
use App\Models\Category;
use App\Models\ProviderProfile;
use App\Models\Service;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * § SEC-1 — the Lipila webhook endpoint is public, so its input is untrusted.
 * Three independent defences are verified here:
 *   1. SIGNATURE. Lipila signs per the Standard Webhooks spec (HMAC-SHA256 over
 *      `{id}.{timestamp}.{raw body}` under the base64-decoded secret); an
 *      unsigned or wrongly-signed request never reaches the lifecycle.
 *   2. TIMESTAMP. A valid signature stays valid forever, so a captured callback
 *      outside the replay window is rejected even though it verifies.
 *   3. STATUS RE-FETCH. Even a correctly-signed body's `status` is not trusted:
 *      a gateway that can verify out-of-band (PaymentStatusVerifier) decides the
 *      outcome, so a forged "Successful" cannot advance a booking.
 */
class WebhookSecurityTest extends TestCase
{
    use RefreshDatabase;

    /** Base64 of 32 bytes, exactly as the dashboard issues it. */
    private const WEBHOOK_SECRET = 'c2ViZW56YS10ZXN0LXNlY3JldC0zMi1ieXRlcy1rZXkh';

    private const WEBHOOK_ID = 'msg_2b1c4d6e8f0a';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'lipila.webhook.secret'           => self::WEBHOOK_SECRET,
            'lipila.webhook.verify_signature' => true,
            'lipila.webhook.tolerance'        => 300,
        ]);
    }

    private function pendingBooking(): Booking
    {
        $category = Category::create(['name' => 'Digital', 'slug' => 'digital', 'is_active' => true, 'risk_tier' => 1, 'display_order' => 1]);

        $provider = User::create(['legal_name' => 'Prov', 'phone' => '+260971111111', 'role' => 'PROVIDER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);
        ProviderProfile::create(['user_id' => $provider->id, 'trust_tier' => 2, 'display_name' => 'Prov', 'momo_number' => $provider->phone]);

        $buyer = User::create(['legal_name' => 'Buy', 'phone' => '+260972222222', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);

        $service = Service::create(['title' => 'S', 'category_id' => $category->id, 'status' => 'ACTIVE', 'base_price' => 500, 'pricing_model' => 'OUTCOME_FIXED', 'provider_id' => $provider->id]);

        $booking = new Booking();
        $booking->forceFill([
            'buyer_id' => $buyer->id, 'provider_id' => $provider->id, 'service_id' => $service->id,
            'amount' => 500, 'payment_mode' => 'ESCROW', 'status' => 'PENDING_PAYMENT',
            'escrow_hold_ref' => 'sbz-dep-forge-1', 'escrow_phase' => 'FULL',
            'scheduled_start' => now()->addDay(), 'scheduled_end' => now()->addDay()->addHour(),
        ])->save();

        return $booking;
    }

    /**
     * POST a raw JSON body with an explicit (possibly wrong / absent) signature.
     * The webhook id and timestamp are part of the signed payload, so they are
     * passed in rather than regenerated — a test that signs one timestamp and
     * sends another would fail for the wrong reason.
     */
    private function sendWebhook(
        array $payload,
        ?string $signature,
        string $id = self::WEBHOOK_ID,
        ?string $timestamp = null,
    ): TestResponse {
        $body    = json_encode($payload);
        $headers = [
            'CONTENT_TYPE'           => 'application/json',
            'HTTP_WEBHOOK_ID'        => $id,
            'HTTP_WEBHOOK_TIMESTAMP' => $timestamp ?? (string) time(),
        ];

        if ($signature !== null) {
            $headers['HTTP_WEBHOOK_SIGNATURE'] = $signature;
        }

        return $this->call('POST', '/api/webhooks/lipila', [], [], [], $headers, $body);
    }

    /** Sign exactly as Lipila does: v1,base64(HMAC-SHA256(id.ts.body, key)). */
    private function sign(array $payload, string $id = self::WEBHOOK_ID, ?string $timestamp = null): string
    {
        $timestamp ??= (string) time();

        return 'v1,' . base64_encode(hash_hmac(
            'sha256',
            $id . '.' . $timestamp . '.' . json_encode($payload),
            base64_decode(self::WEBHOOK_SECRET),
            true,
        ));
    }

    /** The canonical forged payload every rejection test posts. */
    private static function forgedPayload(): array
    {
        return [
            'referenceId' => 'sbz-dep-forge-1',
            'type'        => 'Collection',
            'status'      => 'Successful',
            'amount'      => 500.00,
        ];
    }

    public function test_webhook_rejects_a_missing_signature(): void
    {
        $this->sendWebhook(self::forgedPayload(), null)->assertStatus(401);
    }

    public function test_webhook_rejects_a_wrong_signature(): void
    {
        $this->sendWebhook(self::forgedPayload(), 'v1,' . base64_encode(str_repeat('a', 32)))
            ->assertStatus(401);
    }

    /**
     * A signature over a DIFFERENT body must not validate — this is what stops an
     * attacker replaying a captured signature with an edited amount or reference.
     */
    public function test_webhook_rejects_a_signature_from_a_different_body(): void
    {
        $signature = $this->sign([
            'referenceId' => 'other-ref',
            'type'        => 'Collection',
            'status'      => 'Successful',
        ]);

        $this->sendWebhook(self::forgedPayload(), $signature)->assertStatus(401);
    }

    /**
     * The timestamp is inside the signed payload, so an attacker cannot move it
     * without breaking the signature — but a callback captured verbatim and
     * replayed hours later would still verify. The tolerance window is what
     * closes that, so a genuinely-signed but stale delivery must be rejected.
     */
    public function test_webhook_rejects_a_valid_signature_outside_the_replay_window(): void
    {
        $stale     = (string) (time() - 3600);
        $payload   = self::forgedPayload();
        $signature = $this->sign($payload, self::WEBHOOK_ID, $stale);

        $this->sendWebhook($payload, $signature, self::WEBHOOK_ID, $stale)->assertStatus(401);
    }

    /**
     * A signature computed over a different webhook-id must not validate under
     * the id actually sent — the id is part of the signed payload precisely so it
     * cannot be swapped to defeat replay de-duplication.
     */
    public function test_webhook_rejects_a_signature_bound_to_a_different_webhook_id(): void
    {
        $timestamp = (string) time();
        $payload   = self::forgedPayload();
        $signature = $this->sign($payload, 'msg_some_other_id', $timestamp);

        $this->sendWebhook($payload, $signature, self::WEBHOOK_ID, $timestamp)->assertStatus(401);
    }

    public function test_forged_successful_status_is_ignored_when_gateway_says_otherwise(): void
    {
        // Bind a verifier gateway that reports the collection as still PENDING —
        // i.e. the "successful" in the signed body is a lie (a compromised or
        // replayed-then-resigned payload).
        $this->app->bind(PaymentGateway::class, fn () => new class implements PaymentGateway, PaymentStatusVerifier {
            public function holdFunds(string $p, float $a, string $b, float $c, float $d): string { return 'x'; }
            public function releaseFunds(string $h, string $p, float $a, string $b): ?string { return 'x'; }
            public function refund(string $h, string $p, float $a): ?string { return 'x'; }
            public function status(string $h): array { return ['status' => 'PENDING', 'amount' => 0.0, 'created_at' => '']; }
            public function verifyStatus(string $kind, string $ref): string { return 'PENDING'; }
        });

        $booking = $this->pendingBooking();

        $timestamp = (string) time();
        $payload   = self::forgedPayload();

        $this->sendWebhook(
            $payload,
            $this->sign($payload, self::WEBHOOK_ID, $timestamp),
            self::WEBHOOK_ID,
            $timestamp,
        )->assertOk();

        // The booking must NOT have advanced — the forged status was overridden
        // by the authoritative PENDING re-fetch.
        $this->assertSame('PENDING_PAYMENT', $booking->fresh()->status);
    }
}
