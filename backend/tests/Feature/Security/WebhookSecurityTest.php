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
use Tests\TestCase;

/**
 * § SEC-1 — the PawaPay callback endpoint is public, so its input is untrusted.
 * Two defences are verified here:
 *   1. An optional shared-secret token rejects anonymous callers when configured.
 *   2. The posted `status` is never trusted: a gateway that can verify status
 *      out-of-band (PaymentStatusVerifier) decides the outcome, so a forged
 *      "COMPLETED" cannot advance a booking.
 */
class WebhookSecurityTest extends TestCase
{
    use RefreshDatabase;

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
            'escrow_hold_ref' => 'dep-forge-1', 'escrow_phase' => 'FULL',
            'scheduled_start' => now()->addDay(), 'scheduled_end' => now()->addDay()->addHour(),
        ])->save();

        return $booking;
    }

    public function test_callback_rejects_wrong_token_when_configured(): void
    {
        config()->set('pawapay.callback_token', 'super-secret');

        $this->postJson('/api/pawapay/callback?token=wrong', [
            'depositId' => 'dep-forge-1', 'status' => 'COMPLETED',
        ])->assertStatus(403);
    }

    public function test_forged_completed_status_is_ignored_when_gateway_says_otherwise(): void
    {
        // Bind a verifier gateway that reports the deposit as still PENDING —
        // i.e. the "COMPLETED" in the callback body is a lie.
        $this->app->bind(PaymentGateway::class, fn () => new class implements PaymentGateway, PaymentStatusVerifier {
            public function holdFunds(string $p, float $a, string $b, float $c, float $d): string { return 'x'; }
            public function releaseFunds(string $h, string $p, float $a, string $b): ?string { return 'x'; }
            public function refund(string $h, string $p, float $a): bool { return true; }
            public function status(string $h): array { return ['status' => 'PENDING', 'amount' => 0.0, 'created_at' => '']; }
            public function verifyStatus(string $kind, string $ref): string { return 'PENDING'; }
        });

        $booking = $this->pendingBooking();

        $this->postJson('/api/pawapay/callback', [
            'depositId' => 'dep-forge-1', 'status' => 'COMPLETED',
        ])->assertOk();

        // The booking must NOT have advanced — the forged status was overridden
        // by the authoritative PENDING re-fetch.
        $this->assertSame('PENDING_PAYMENT', $booking->fresh()->status);
    }
}
