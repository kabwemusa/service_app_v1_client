<?php

namespace Tests\Feature\Provider;

use App\Models\ProviderProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * § CTR-1 — NRC is mandatory at Tier 1. The three surfaces must agree: the API
 * requires a valid NRC number, persists it uniquely (anti-duplicate identity),
 * and rejects a missing/invalid/duplicate NRC.
 */
class KycTier1NrcTest extends TestCase
{
    use RefreshDatabase;

    private function provider(string $phone): User
    {
        $u = User::create([
            'legal_name' => 'P', 'phone' => $phone, 'role' => 'PROVIDER',
            'account_state' => 'ACTIVE', 'is_verified' => true, 'password_hash' => Hash::make('x'),
        ]);
        ProviderProfile::create(['user_id' => $u->id, 'onboarding_state' => 'DRAFT']);
        return $u;
    }

    public function test_tier1_requires_a_valid_nrc(): void
    {
        Storage::fake('local');
        $u = $this->provider('+260971111111');

        // Missing NRC → 422
        $this->actingAs($u, 'api')->postJson('/api/kyc/tier1', [
            'legal_name' => 'John Banda',
            'selfie'     => UploadedFile::fake()->image('selfie.jpg'),
        ])->assertStatus(422);

        // Invalid format → 422
        $this->actingAs($u, 'api')->post('/api/kyc/tier1', [
            'legal_name' => 'John Banda',
            'nrc_number' => 'not-an-nrc',
            'selfie'     => UploadedFile::fake()->image('selfie.jpg'),
        ])->assertStatus(422);

        // Valid → 201 and the NRC is persisted (hashed) on the profile
        $this->actingAs($u, 'api')->post('/api/kyc/tier1', [
            'legal_name' => 'John Banda',
            'nrc_number' => '123456/78/1',
            'selfie'     => UploadedFile::fake()->image('selfie.jpg'),
        ])->assertStatus(201);

        $this->assertNotNull($u->fresh()->providerProfile->nrc_number);
        $this->assertSame(1, (int) $u->fresh()->providerProfile->trust_tier);
    }

    public function test_duplicate_nrc_is_rejected(): void
    {
        Storage::fake('local');
        $a = $this->provider('+260971111111');
        $b = $this->provider('+260972222222');

        $this->actingAs($a, 'api')->post('/api/kyc/tier1', [
            'legal_name' => 'John Banda', 'nrc_number' => '123456/78/1',
            'selfie' => UploadedFile::fake()->image('a.jpg'),
        ])->assertStatus(201);

        // Same NRC on a different account → 409 DUPLICATE_IDENTITY
        $this->actingAs($b, 'api')->post('/api/kyc/tier1', [
            'legal_name' => 'Jane Phiri', 'nrc_number' => '123456/78/1',
            'selfie' => UploadedFile::fake()->image('b.jpg'),
        ])->assertStatus(409);
    }
}
