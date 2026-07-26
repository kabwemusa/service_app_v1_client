<?php

namespace Tests\Feature\Security;

use App\Contracts\PaymentGateway;
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
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Booking-path authorization (§ SEC-9, § SEC-4, § SEC-5).
 */
class BookingSecurityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        $this->app->bind(PaymentGateway::class, fn () => new class implements PaymentGateway {
            public function holdFunds(string $p, float $a, string $b, float $c, float $d): string { return 'HOLD-' . Str::uuid(); }
            public function releaseFunds(string $h, string $p, float $a, string $b): ?string { return 'PAY-' . Str::uuid(); }
            public function refund(string $h, string $p, float $a): bool { return true; }
            public function status(string $h): array { return ['status' => 'HELD', 'amount' => 0.0, 'created_at' => now()->toIso8601String()]; }
        });
    }

    private function seedProviderAndService(): array
    {
        $category = Category::create(['name' => 'Digital', 'slug' => 'digital', 'is_active' => true, 'risk_tier' => 1, 'display_order' => 1]);

        $provider = User::create(['legal_name' => 'Prov', 'phone' => '+260971111111', 'role' => 'PROVIDER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);
        ProviderProfile::create(['user_id' => $provider->id, 'trust_tier' => 3, 'accepting_bookings' => true, 'display_name' => 'Prov', 'momo_number' => $provider->phone]);
        foreach (['nrc', 'momo_name_match'] as $type) {
            ProviderVerification::create(['provider_id' => $provider->id, 'verification_type' => $type, 'status' => 'VERIFIED', 'verified_at' => now()]);
        }
        for ($day = 0; $day <= 6; $day++) {
            ProviderAvailability::create(['provider_id' => $provider->id, 'day_of_week' => $day, 'start_time' => '08:00', 'end_time' => '17:00', 'is_recurring' => true]);
        }
        $service = Service::create(['title' => 'Web', 'category_id' => $category->id, 'status' => 'ACTIVE', 'base_price' => 500, 'pricing_model' => 'OUTCOME_FIXED', 'provider_id' => $provider->id]);

        return [$provider, $service];
    }

    private function bookingPayload(Service $service, User $provider): array
    {
        $start = Carbon::now('Africa/Lusaka')->next(Carbon::MONDAY)->setTime(10, 0);
        return [
            'service_id' => $service->id, 'provider_id' => $provider->id,
            'scheduled_start' => $start->toIso8601String(),
            'scheduled_end' => $start->copy()->addHour()->toIso8601String(),
            'delivery_lat' => -15.39, 'delivery_lng' => 28.32, 'channel' => 'APP',
        ];
    }

    public function test_banned_buyer_cannot_create_a_booking(): void
    {
        [$provider, $service] = $this->seedProviderAndService();
        $banned = User::create(['legal_name' => 'Bad', 'phone' => '+260972222222', 'role' => 'CUSTOMER', 'account_state' => 'BANNED', 'password_hash' => Hash::make('x')]);

        try {
            app(BookingService::class)->create($banned, $this->bookingPayload($service, $provider));
            $this->fail('Expected a banned buyer to be blocked from booking.');
        } catch (ApiException $e) {
            $this->assertSame(ErrorCode::ACCOUNT_RESTRICTED, $e->getErrorCode());
        }
    }

    public function test_booking_payload_hides_counterparty_email(): void
    {
        [$provider, $service] = $this->seedProviderAndService();
        $buyer = User::create(['legal_name' => 'Good', 'email' => 'buyer@test.zm', 'phone' => '+260972222222', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);

        $booking = app(BookingService::class)->create($buyer, $this->bookingPayload($service, $provider));

        // Provider views the booking — must not see the buyer's email/phone.
        $res = $this->actingAs($provider, 'api')->getJson("/api/bookings/{$booking->id}");
        $res->assertOk();
        $res->assertJsonMissingPath('data.buyer.email');
        $res->assertJsonMissingPath('data.provider.email');
    }

    public function test_non_party_cannot_read_scope_attachment(): void
    {
        [$provider, $service] = $this->seedProviderAndService();
        $buyer = User::create(['legal_name' => 'Good', 'phone' => '+260972222222', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);
        $stranger = User::create(['legal_name' => 'Nosy', 'phone' => '+260973333333', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);

        $booking = app(BookingService::class)->create($buyer, $this->bookingPayload($service, $provider));
        Booking::whereKey($booking->id)->update(['scope_brief_attachments' => json_encode([['path' => 'booking_attachments/x.jpg', 'type' => 'image']])]);

        // A stranger is refused; a party gets past authorization (404 only because
        // the file itself doesn't exist on disk in this test).
        $this->actingAs($stranger, 'api')->get("/api/bookings/{$booking->id}/scope-attachments/0")->assertStatus(403);
        $this->actingAs($buyer, 'api')->get("/api/bookings/{$booking->id}/scope-attachments/0")->assertStatus(404);
    }
}
