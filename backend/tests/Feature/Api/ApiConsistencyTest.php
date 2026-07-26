<?php

namespace Tests\Feature\Api;

use App\Support\ApiResponse;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

/**
 * § API-1 / API-3 — canonical pagination shape, and the legacy auth gate keeps
 * the routes available while enabled (the default).
 */
class ApiConsistencyTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Redis::flushdb();
    }

    public function test_paginated_helper_uses_canonical_shape(): void
    {
        $paginator = new LengthAwarePaginator([['id' => 1], ['id' => 2]], total: 5, perPage: 2, currentPage: 1);

        $body = ApiResponse::paginated($paginator, message: 'Ok.')->getData(true);

        $this->assertTrue($body['success']);
        $this->assertSame(['data', 'current_page', 'last_page', 'per_page', 'total'], array_keys($body['data']));
        $this->assertSame(1, $body['data']['current_page']);
        $this->assertSame(3, $body['data']['last_page']);
        $this->assertSame(2, $body['data']['per_page']);
        $this->assertSame(5, $body['data']['total']);
    }

    public function test_legacy_login_route_available_by_default(): void
    {
        // With AUTH_LEGACY_PASSWORD_AUTH at its default (true), the route exists;
        // bad credentials return a 401 envelope, not a 404 (route missing).
        $this->assertTrue((bool) config('auth.legacy_password_auth'));

        $this->postJson('/api/auth/login', ['identifier' => 'nobody@test.zm', 'password' => 'wrongpassword'])
            ->assertStatus(401)
            ->assertJsonPath('code', 'INVALID_CREDENTIALS');
    }

    public function test_phone_otp_remains_the_canonical_path(): void
    {
        // The canonical auth is unaffected by the legacy gate.
        $this->postJson('/api/auth/otp/request', ['phone' => '0971234567'])
            ->assertOk()
            ->assertJsonPath('data.phone', '+260971234567');
    }
}
