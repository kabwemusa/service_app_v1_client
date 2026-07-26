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
        // A WhatsApp-first account. Numbers are stored canonically (E.164) — new
        // WhatsApp rows are normalized on creation, and legacy loosely-stored rows
        // are canonicalized by the one-time phone backfill migration (§ SEC-8), so
        // identity matching is strict equality, not a trailing-digits LIKE.
        $wa = User::create(['phone' => '+260971234567', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE']);

        // A PWA sign-in for the SAME number in local format resolves to the same
        // account (normalization collapses the format before the strict match).
        $this->postJson('/api/auth/otp/request', ['phone' => '0971234567'])->assertOk();

        $this->assertSame(1, User::where('phone', 'LIKE', '%971234567')->count());
        $this->assertSame($wa->id, User::where('phone', '+260971234567')->first()->id);
    }

    // ── Rate limiting ────────────────────────────────────────────────────────

    public function test_resend_cooldown_blocks_immediate_repeat(): void
    {
        $this->postJson('/api/auth/otp/request', ['phone' => '0971234567'])->assertOk();
        $this->postJson('/api/auth/otp/request', ['phone' => '0971234567'])
            ->assertStatus(429)
            ->assertJsonPath('code', 'RATE_LIMITED');
    }

    // ── OTP brute-force lockout (§ SEC-2) ────────────────────────────────────

    public function test_otp_is_burned_after_too_many_wrong_guesses(): void
    {
        // Isolate the per-code, IP-independent lockout (§ SEC-2) from the per-IP
        // route throttle (which is a separate, coarser protection). An attacker
        // rotating IPs bypasses the throttle but must still hit the per-code burn.
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);

        $this->postJson('/api/auth/otp/request', ['phone' => '0971234567'])->assertOk();
        $otp = $this->sms->lastOtp('+260971234567');

        // Five wrong guesses are each rejected as invalid…
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/otp/verify', ['phone' => '0971234567', 'otp' => '000000'])
                ->assertStatus(422)
                ->assertJsonPath('code', 'OTP_INVALID');
        }

        // …the sixth attempt is rate-limited and burns the code.
        $this->postJson('/api/auth/otp/verify', ['phone' => '0971234567', 'otp' => '000000'])
            ->assertStatus(429)
            ->assertJsonPath('code', 'RATE_LIMITED');

        // Even the CORRECT code no longer works — a fresh request is required.
        $this->postJson('/api/auth/otp/verify', ['phone' => '0971234567', 'otp' => $otp])
            ->assertStatus(422)
            ->assertJsonPath('code', 'OTP_EXPIRED');
    }
}
