<?php

namespace Tests\Feature\Security;

use App\Models\User;
use App\Services\AuthService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

/**
 * § ADM-2 / SEC-15 — account-state enforcement: timed suspensions auto-lift, and
 * banned/suspended accounts cannot obtain tokens at login.
 */
class AccountStateTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Redis::flushdb();
    }

    private function user(string $state, ?string $suspendedUntil = null): User
    {
        return User::create([
            'legal_name'      => 'X', 'phone' => '+260971234567', 'role' => 'CUSTOMER',
            'account_state'   => $state,
            'suspended_until' => $suspendedUntil,
            'is_verified'     => true,
            'password_hash'   => Hash::make('secret1234'),
        ]);
    }

    public function test_banned_user_cannot_get_tokens(): void
    {
        $this->user('BANNED');

        $this->expectException(\App\Exceptions\Api\ApiException::class);
        app(AuthService::class)->login('+260971234567', 'secret1234');
    }

    public function test_active_suspension_blocks_login(): void
    {
        $this->user('SUSPENDED', now()->addDays(3)->toDateTimeString());

        $this->expectException(\App\Exceptions\Api\ApiException::class);
        app(AuthService::class)->login('+260971234567', 'secret1234');
    }

    public function test_expired_suspension_auto_lifts_on_login(): void
    {
        $user = $this->user('SUSPENDED', now()->subDay()->toDateTimeString());

        $tokens = app(AuthService::class)->login('+260971234567', 'secret1234');

        $this->assertArrayHasKey('access_token', $tokens);
        $this->assertSame('ACTIVE', $user->fresh()->account_state);
        $this->assertNull($user->fresh()->suspended_until);
    }

    public function test_expired_suspension_auto_lifts_on_authenticated_request(): void
    {
        // Mint a token while ACTIVE, then apply a suspension that has already
        // expired: EnsureAccountActive must auto-lift it on the next request.
        $user  = $this->user('ACTIVE');
        $token = \Tymon\JWTAuth\Facades\JWTAuth::fromUser($user);
        $user->forceFill(['account_state' => 'SUSPENDED', 'suspended_until' => now()->subHour()])->save();

        $this->withToken($token)->getJson('/api/bookings')->assertOk();

        $this->assertSame('ACTIVE', $user->fresh()->account_state);
    }
}
