<?php

namespace Tests\Feature\Provider;

use App\Contracts\TrustEngine;
use App\Enums\DocStatus;
use App\Exceptions\Api\ApiException;
use App\Models\AdminUser;
use App\Models\Category;
use App\Models\IdentityDocument;
use App\Models\ProviderProfile;
use App\Models\ProviderService;
use App\Models\ProviderVerification;
use App\Models\Service;
use App\Models\User;
use App\Services\AdminVerificationService;
use App\Services\ProviderVerificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProviderTierUpgradeTest extends TestCase
{
    use RefreshDatabase;

    private ProviderVerificationService $service;
    private AdminVerificationService $admin;
    private TrustEngine $trust;

    protected function setUp(): void
    {
        parent::setUp();
        Redis::flushdb();
        Storage::fake('local');
        $this->service = app(ProviderVerificationService::class);
        $this->admin   = app(AdminVerificationService::class);
        $this->trust   = app(TrustEngine::class);
    }

    private function provider(int $tier, array $verifications, int $riskTier): array
    {
        $user = User::create([
            'legal_name' => 'Jane Provider', 'phone' => '+26097' . random_int(1000000, 9999999),
            'role' => 'PROVIDER', 'account_state' => 'ACTIVE',
        ]);
        ProviderProfile::create([
            'user_id' => $user->id, 'trust_tier' => $tier, 'accepting_bookings' => true,
            'display_name' => 'Jane', 'momo_provider' => 'MTN', 'momo_number' => $user->phone,
        ]);
        foreach ($verifications as $v) {
            ProviderVerification::create(['provider_id' => $user->id, 'verification_type' => $v, 'status' => 'VERIFIED', 'verified_at' => now()]);
        }
        $cat = Category::create(['name' => "Cat{$riskTier}", 'slug' => "cat-{$riskTier}-" . random_int(1, 9999), 'is_active' => true, 'risk_tier' => $riskTier]);
        $svc = Service::create(['title' => 'Job', 'category_id' => $cat->id, 'status' => 'ACTIVE', 'base_price' => 100, 'pricing_model' => 'OUTCOME_FIXED', 'provider_id' => $user->id]);
        ProviderService::create(['provider_id' => $user->id, 'service_id' => $svc->id, 'price' => 100, 'pricing_model' => 'OUTCOME_FIXED', 'status' => 'ACTIVE']);

        return [$user, $svc];
    }

    private function reviewer(): AdminUser
    {
        return AdminUser::create(['name' => 'Rev', 'username' => 'rev' . random_int(1, 9999), 'email' => 'rev' . random_int(1, 9999) . '@x.zm', 'password' => 'secret', 'role' => 'super_admin']);
    }

    private function approve(IdentityDocument $doc): void
    {
        $admin = $this->reviewer();
        $this->admin->claim($doc->fresh(), $admin);
        $this->admin->approve($doc->fresh(), $admin, 'looks good');
    }

    public function test_police_clearance_submit_enters_queue_and_approval_flips_eligibility(): void
    {
        [$user, $svc] = $this->provider(3, ['nrc', 'momo_name_match', 'portfolio'], 3);

        // Pending the missing tier-3 requirement, the listing is non-dispatchable.
        $this->assertFalse($this->trust->checkEligibility($user->id, $svc->id)['eligible']);
        $this->assertContains('police_clearance', $this->trust->checkEligibility($user->id, $svc->id)['missing']);

        $doc = $this->service->submitPoliceClearance($user, UploadedFile::fake()->image('clr.jpg'), 'PC-123', '2025-01-01');
        $this->assertDatabaseHas('identity_documents', ['id' => $doc->id, 'doc_type' => 'CERTIFICATE', 'status' => 'SUBMITTED']);

        // Appears in the EXISTING admin queue as a CERTIFICATION submission.
        $queue = $this->admin->list(['type' => 'CERTIFICATION']);
        $this->assertNotEmpty(array_filter($queue['data'], fn ($r) => $r['id'] === $doc->id));

        $this->approve($doc);

        // Eligibility flips — server-side — and the listing becomes dispatchable.
        $this->assertDatabaseHas('provider_verifications', ['provider_id' => $user->id, 'verification_type' => 'police_clearance', 'status' => 'VERIFIED']);
        $this->assertTrue($this->trust->checkEligibility($user->id, $svc->id)['eligible']);
    }

    public function test_portfolio_submit_and_approval_flips_eligibility(): void
    {
        [$user, $svc] = $this->provider(2, ['nrc', 'momo_name_match'], 2);
        $this->assertFalse($this->trust->checkEligibility($user->id, $svc->id)['eligible']);

        $doc = $this->service->submitPortfolio($user, [
            UploadedFile::fake()->image('a.jpg'),
            UploadedFile::fake()->image('b.jpg'),
            UploadedFile::fake()->image('c.jpg'),
        ]);

        $this->approve($doc);

        $this->assertDatabaseHas('provider_verifications', ['provider_id' => $user->id, 'verification_type' => 'portfolio', 'status' => 'VERIFIED']);
        $this->assertTrue($this->trust->checkEligibility($user->id, $svc->id)['eligible']);
    }

    public function test_portfolio_pipeline_rejects_nsfw_image_before_review(): void
    {
        [$user] = $this->provider(2, ['nrc', 'momo_name_match'], 2);

        $this->expectException(ApiException::class);
        try {
            $this->service->submitPortfolio($user, [
                UploadedFile::fake()->image('a.jpg'),
                UploadedFile::fake()->image('b.jpg'),
                UploadedFile::fake()->image('nsfw_bad.jpg'),
            ]);
        } finally {
            // Nothing queued for a flagged batch.
            $this->assertDatabaseMissing('identity_documents', ['user_id' => $user->id]);
        }
    }

    public function test_single_in_flight_submission_per_tier(): void
    {
        [$user] = $this->provider(3, ['nrc', 'momo_name_match', 'portfolio'], 3);
        $this->service->submitPoliceClearance($user, UploadedFile::fake()->image('clr.jpg'), 'PC-1', '2025-01-01');

        $this->expectException(ApiException::class);
        $this->service->submitPoliceClearance($user, UploadedFile::fake()->image('clr2.jpg'), 'PC-2', '2025-02-01');
    }

    public function test_status_ladder_reflects_under_review_then_done(): void
    {
        [$user] = $this->provider(2, ['nrc', 'momo_name_match'], 2);

        $doc = $this->service->submitPortfolio($user, [
            UploadedFile::fake()->image('a.jpg'),
            UploadedFile::fake()->image('b.jpg'),
            UploadedFile::fake()->image('c.jpg'),
        ]);

        $tier2 = collect($this->service->status($user)['tiers'])->firstWhere('tier', 2);
        $this->assertSame('UNDER_REVIEW', $tier2['state']);

        $this->approve($doc);

        $tier2 = collect($this->service->status($user)['tiers'])->firstWhere('tier', 2);
        $this->assertSame('DONE', $tier2['state']);
    }

    public function test_rejected_submission_allows_resubmit(): void
    {
        [$user] = $this->provider(3, ['nrc', 'momo_name_match', 'portfolio'], 3);
        $doc = $this->service->submitPoliceClearance($user, UploadedFile::fake()->image('clr.jpg'), 'PC-1', '2025-01-01');

        $admin = $this->reviewer();
        $this->admin->claim($doc->fresh(), $admin);
        $this->admin->reject($doc->fresh(), $admin, 'blurry — please retake');

        $tier3 = collect($this->service->status($user)['tiers'])->firstWhere('tier', 3);
        $this->assertSame('NEEDS_CHANGES', $tier3['state']);
        $this->assertSame('blurry — please retake', $tier3['reason']);

        // Resubmission is allowed (no in-flight conflict after a rejection).
        $resub = $this->service->submitPoliceClearance($user, UploadedFile::fake()->image('clr2.jpg'), 'PC-2', '2025-02-01');
        $this->assertSame(DocStatus::SUBMITTED->value, $resub->status);
    }
}
