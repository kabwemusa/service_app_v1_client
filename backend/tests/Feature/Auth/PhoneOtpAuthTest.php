<?php

namespace Tests\Feature\Auth;

use App\Contracts\SmsGateway;
use App\Models\ProviderProfile;
use App\Models\User;
use App\Support\PhoneNumber;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Redis;
use Tests\Support\RecordingSmsGateway;
use Tests\TestCase;

class PhoneOtpAuthTest extends TestCase
{
    use RefreshDatabase;

    private RecordingSmsGateway $sms;

    protected function setUp(): void
    {
        parent::setUp();

        // Clear OTP / cooldown / rate keys between tests so they're independent.
        Redis::flushdb();

        $this->sms = new RecordingSmsGateway();
        $this->app->instance(SmsGateway::class, $this->sms);
    }

    // ── Normalizer ───────────────────────────────────────────────────────────

    public function test_phone_normalizes_all_zambian_formats_to_one_e164(): void
    {
        $canonical = '+260971234567';

        $this->assertSame($canonical, PhoneNumber::normalize('+260971234567'));
        $this->assertSame($canonical, PhoneNumber::normalize('260971234567'));
        $this->assertSame($canonical, PhoneNumber::normalize('0971234567'));
        $this->assertSame($canonical, PhoneNumber::normalize('971234567'));
        $this->assertSame($canonical, PhoneNumber::normalize(' +260 97 123 4567 '));

        $this->assertNull(PhoneNumber::normalize('12345'));        // too short
        $this->assertNull(PhoneNumber::normalize('260121234567')); // not 7/9 prefix
        $this->assertNull(PhoneNumber::normalize('not a phone'));
    }

    // ── Request → verify happy path ──────────────────────────────────────────

    public function test_request_then_verify_creates_account_and_issues_tokens(): void
    {
        $req = $this->postJson('/api/auth/otp/request', ['phone' => '0971234567']);
        $req->assertOk()
            ->assertJsonPath('data.phone', '+260971234567')
            ->assertJsonPath('data.is_new', true);

        $this->assertDatabaseHas('users', ['phone' => '+260971234567', 'role' => 'CUSTOMER']);

        $otp = $this->sms->lastOtp('+260971234567');
        $this->assertNotNull($otp);

        $verify = $this->postJson('/api/auth/otp/verify', ['phone' => '+260971234567', 'otp' => $otp]);
        $verify->assertOk()
            ->assertJsonPath('data.token_type', 'bearer')
            ->assertJsonStructure(['data' => ['access_token', 'refresh_token', 'user' => ['id', 'phone', 'role']]]);

        $this->assertNotNull(User::where('phone', '+260971234567')->first()->phone_verified_at);
    }

    public function test_provider_intent_creates_profile_in_draft(): void
    {
        $this->postJson('/api/auth/otp/request', ['phone' => '0979876543', 'intent' => 'PROVIDER'])->assertOk();

        $user = User::where('phone', '+260979876543')->firstOrFail();
        $this->assertSame('PROVIDER', $user->role);
        $this->assertSame('DRAFT', ProviderProfile::find($user->id)?->onboarding_state);
    }

    public function test_wrong_otp_is_rejected(): void
    {
        $this->postJson('/api/auth/otp/request', ['phone' => '0971234567'])->assertOk();

        $this->postJson('/api/auth/otp/verify', ['phone' => '0971234567', 'otp' => '000000'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'OTP_INVALID');
    }

    // ── One account per phone, across formats and surfaces ───────────────────

    public function test_same_number_in_any_format_resolves_to_one_account(): void
    {
        $this->postJson('/api/auth/otp/request', ['phone' => '0971234567'])->assertOk();
        // A second request for the SAME number in a different format must not
        // create a duplicate. (Different number to dodge the cooldown.)
        $this->postJson('/api/auth/otp/request', ['phone' => '260971234567'])
            ->assertStatus(429); // cooldown proves it's treated as the same key

        $this->assertSame(1, User::where('phone', 'LIKE', '%971234567')->count());
    }

    public function test_whatsapp_created_account_is_reused_by_pwa_otp(): void
    {
        // Simulate a WhatsApp-first account stored without the leading +.
        $wa = User::create(['phone' => '260971234567', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE']);

        $this->postJson('/api/auth/otp/request', ['phone' => '+260971234567'])->assertOk();

        // No duplicate; the existing row is canonicalized to E.164.
        $this->assertSame(1, User::where('phone', 'LIKE', '%971234567')->count());
        $this->assertSame('+260971234567', $wa->fresh()->phone);
    }

    // ── Rate limiting ────────────────────────────────────────────────────────

    public function test_resend_cooldown_blocks_immediate_repeat(): void
    {
        $this->postJson('/api/auth/otp/request', ['phone' => '0971234567'])->assertOk();
        $this->postJson('/api/auth/otp/request', ['phone' => '0971234567'])
            ->assertStatus(429)
            ->assertJsonPath('code', 'RATE_LIMITED');
    }
}
