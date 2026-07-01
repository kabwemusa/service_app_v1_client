<?php

namespace Tests\Feature\Provider;

use App\Contracts\SmsGateway;
use App\Contracts\WalletNameLookupInterface;
use App\Models\Category;
use App\Models\ProviderProfile;
use App\Models\ProviderService;
use App\Models\ProviderVerification;
use App\Models\Service;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;
use Tests\Support\RecordingSmsGateway;
use Tests\TestCase;

class ProviderOnboardingTest extends TestCase
{
    use RefreshDatabase;

    private Category $remote;   // risk_tier 1
    private Category $inHome;   // risk_tier 3

    protected function setUp(): void
    {
        parent::setUp();

        Redis::flushdb();
        Storage::fake('public');
        Storage::fake('local');
        $this->app->instance(SmsGateway::class, new RecordingSmsGateway());

        $this->remote = Category::create(['name' => 'Digital', 'slug' => 'digital', 'is_active' => true, 'risk_tier' => 1, 'display_order' => 1]);
        $this->inHome = Category::create(['name' => 'Home',    'slug' => 'home',    'is_active' => true, 'risk_tier' => 3, 'display_order' => 2]);
    }

    /** Create a phone-OTP provider account and return [user, bearerToken]. */
    private function provider(string $name = 'John Doe'): array
    {
        $user = User::findOrCreateByPhone('+260971234567', 'PROVIDER');
        $user->update(['legal_name' => $name, 'phone_verified_at' => now(), 'is_verified' => true]);
        $token = auth('api')->login($user);

        return [$user, $token];
    }

    private function asProvider(string $token): array
    {
        return ['Authorization' => "Bearer {$token}"];
    }

    public function test_new_provider_profile_starts_in_draft(): void
    {
        [$user] = $this->provider();
        $this->assertSame('DRAFT', ProviderProfile::find($user->id)->onboarding_state);
    }

    public function test_steps_persist_and_state_resumes(): void
    {
        [$user, $token] = $this->provider();

        $this->postJson('/api/provider/onboarding/about', [
            'name' => 'John Doe', 'languages' => ['en', 'bem'], 'area_label' => 'Lusaka',
            'latitude' => -15.39, 'longitude' => 28.32,
        ], $this->asProvider($token))->assertOk();

        $this->postJson('/api/provider/onboarding/offer', [
            'category_id' => $this->remote->id,
        ], $this->asProvider($token))->assertOk();

        // A fresh GET resumes the saved cursor + collected data (drop-off resume).
        $state = $this->getJson('/api/provider/onboarding', $this->asProvider($token))->assertOk();
        $state->assertJsonPath('data.collected.languages', ['en', 'bem']);
        $state->assertJsonPath('data.collected.category_id', $this->remote->id);
        $state->assertJsonPath('data.step', 'identity');
    }

    public function test_tier1_remote_provider_goes_live(): void
    {
        [$user, $token] = $this->provider('John Doe');

        $this->postJson('/api/provider/onboarding/offer', ['category_id' => $this->remote->id], $this->asProvider($token))->assertOk();
        $this->submitIdentity($token);
        $this->postJson('/api/provider/onboarding/service', [
            'title' => 'Logo Design', 'price' => 150, 'pricing_model' => 'FIXED',
        ], $this->asProvider($token))->assertCreated();

        // KYC bridge wrote the verifications the gate reads → eligible → LIVE.
        $this->assertDatabaseHas('provider_verifications', ['provider_id' => $user->id, 'verification_type' => 'nrc', 'status' => 'VERIFIED']);
        $this->assertDatabaseHas('provider_verifications', ['provider_id' => $user->id, 'verification_type' => 'momo_name_match', 'status' => 'VERIFIED']);

        $res = $this->postJson('/api/provider/onboarding/go-live', [], $this->asProvider($token))->assertOk();
        $res->assertJsonPath('data.is_live', true)->assertJsonPath('data.state', 'LIVE');
        $this->assertSame('LIVE', ProviderProfile::find($user->id)->onboarding_state);
    }

    public function test_tier3_inhome_provider_is_set_up_not_live(): void
    {
        [$user, $token] = $this->provider('John Doe');

        $this->postJson('/api/provider/onboarding/offer', ['category_id' => $this->inHome->id], $this->asProvider($token))->assertOk();
        $this->submitIdentity($token);
        $this->postJson('/api/provider/onboarding/service', [
            'title' => 'Plumbing', 'price' => 200, 'pricing_model' => 'HOURLY',
        ], $this->asProvider($token))->assertCreated();

        $res = $this->postJson('/api/provider/onboarding/go-live', [], $this->asProvider($token))->assertOk();
        $res->assertJsonPath('data.is_live', false)->assertJsonPath('data.state', 'SET_UP');

        // The listing exists but is gated (non-dispatchable) until the extra
        // verification lands; the ladder names the in-home requirements.
        $this->assertDatabaseHas('provider_services', ['provider_id' => $user->id, 'status' => 'ACTIVE']);
        $this->assertNotEmpty($res->json('data.eligibility.missing'));
        $rungTypes = array_column($res->json('data.tier_ladder.rungs'), 'type');
        $this->assertContains('police_clearance', $rungTypes);
    }

    public function test_momo_mismatch_routes_to_manual_review_and_blocks_eligibility(): void
    {
        // Wallet returns a name that does NOT match the verified ID → MATCH_FAIL.
        $this->app->instance(WalletNameLookupInterface::class, new class implements WalletNameLookupInterface {
            public function lookupName(string $momoProvider, string $momoNumber): ?string
            {
                return 'Someone Else';
            }
        });

        [$user, $token] = $this->provider('John Doe');
        $this->postJson('/api/provider/onboarding/offer', ['category_id' => $this->remote->id], $this->asProvider($token))->assertOk();
        $this->submitIdentity($token);

        // No momo_name_match verification was recorded (it was a mismatch) → not eligible.
        $this->assertDatabaseMissing('provider_verifications', [
            'provider_id' => $user->id, 'verification_type' => 'momo_name_match',
        ]);
    }

    private function submitIdentity(string $token): void
    {
        $this->postJson('/api/provider/onboarding/identity', [
            'nrc_front'   => UploadedFile::fake()->image('nrc.jpg'),
            'selfie'      => UploadedFile::fake()->image('selfie.jpg'),
            'momo_number' => '+260971234567',
            'momo_provider' => 'MTN',
        ], $this->asProvider($token))->assertOk();
    }
}
