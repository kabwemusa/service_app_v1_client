<?php

namespace Tests\Feature\Legal;

use App\Models\ConsentRecord;
use App\Models\LegalDocument;
use App\Models\User;
use Database\Seeders\LegalDocumentSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tymon\JWTAuth\Facades\JWTAuth;
use Tests\TestCase;

/**
 * Exercises the consent MECHANISM (not the wording): the gate's accept/decline,
 * the append-only versioned audit, re-consent on a material version bump,
 * withdrawal, and data-subject-rights capture.
 */
class ConsentFlowTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(LegalDocumentSeeder::class); // three draft documents
        $this->user = User::create([
            'phone'         => '+260971234567',
            'role'          => 'CUSTOMER',
            'account_state' => 'ACTIVE',
            'is_verified'   => true,
        ]);
    }

    private function auth(): array
    {
        $token = JWTAuth::fromUser($this->user);
        return ['Authorization' => "Bearer {$token}"];
    }

    // ── Public documents ─────────────────────────────────────────────────────

    public function test_documents_are_publicly_listable_and_readable(): void
    {
        $this->getJson('/api/legal/documents')
            ->assertOk()
            ->assertJsonPath('data.draft_mode', true)
            ->assertJsonCount(3, 'data.documents');

        $this->getJson('/api/legal/documents/privacy_policy')
            ->assertOk()
            ->assertJsonPath('data.type', 'privacy_policy')
            ->assertJsonStructure(['data' => ['content' => ['intro', 'sections']]]);

        $this->getJson('/api/legal/documents/bogus')->assertStatus(404);
    }

    // ── Gate: a new user must consent ────────────────────────────────────────

    public function test_new_user_needs_consent(): void
    {
        $this->getJson('/api/me/consent', $this->auth())
            ->assertOk()
            ->assertJsonPath('data.needs_consent', true)
            ->assertJsonPath('data.reason', 'NEW')
            ->assertJsonCount(3, 'data.outstanding');
    }

    // ── Accept: records a versioned, unbundled consent ───────────────────────

    public function test_accept_records_versioned_consent_with_optional_toggles(): void
    {
        $this->postJson('/api/me/consent', [
            'accept_required' => true,
            'marketing'       => true,
            'analytics'       => false,
        ], $this->auth())->assertCreated();

        $record = ConsentRecord::where('user_id', $this->user->id)->firstOrFail();
        $this->assertSame('GRANT', $record->event);
        $this->assertTrue($record->marketing_opt_in);
        $this->assertFalse($record->analytics_opt_in);
        // The exact versions accepted are snapshotted (demonstrable consent).
        $versions = collect($record->documents)->pluck('version')->unique();
        $this->assertSame(['0.1.0-draft'], $versions->values()->all());

        $this->getJson('/api/me/consent', $this->auth())
            ->assertJsonPath('data.needs_consent', false)
            ->assertJsonPath('data.marketing_opt_in', true)
            ->assertJsonPath('data.analytics_opt_in', false);
    }

    public function test_accept_requires_the_required_flag(): void
    {
        // Not ticking the required agreement must be rejected (no dark-pattern bypass).
        $this->postJson('/api/me/consent', ['accept_required' => false], $this->auth())
            ->assertStatus(422);
    }

    // ── Decline: recorded, and blocks (needs_consent stays true) ─────────────

    public function test_decline_is_recorded(): void
    {
        $this->postJson('/api/me/consent/decline', [], $this->auth())->assertOk();

        $this->assertDatabaseHas('consent_records', [
            'user_id' => $this->user->id,
            'event'   => 'DECLINE',
        ]);
        // A decline is not an acceptance — the user still needs consent.
        $this->getJson('/api/me/consent', $this->auth())
            ->assertJsonPath('data.needs_consent', true);
    }

    // ── Re-consent on a material version bump ────────────────────────────────

    public function test_material_version_bump_triggers_reconsent(): void
    {
        $this->postJson('/api/me/consent', ['accept_required' => true], $this->auth())->assertCreated();
        $this->getJson('/api/me/consent', $this->auth())->assertJsonPath('data.needs_consent', false);

        // Publish a new material version of one document. Travel forward so its
        // created_at is genuinely later than the seeded version (a real bump
        // happens later in time; created_at is second-precision).
        $this->travel(1)->minutes();
        LegalDocument::create([
            'type'        => 'privacy_policy',
            'version'     => '0.2.0-draft',
            'status'      => 'draft',
            'title'       => 'Privacy Policy',
            'content'     => ['intro' => 'x', 'sections' => []],
            'is_material' => true,
        ]);
        $this->travelBack();

        $this->getJson('/api/me/consent', $this->auth())
            ->assertJsonPath('data.needs_consent', true)
            ->assertJsonPath('data.reason', 'VERSION_CHANGE');

        // Re-accepting records a RECONSENT and keeps the prior GRANT (history intact).
        $this->postJson('/api/me/consent', ['accept_required' => true], $this->auth())->assertCreated();
        $this->assertSame(1, ConsentRecord::where('user_id', $this->user->id)->where('event', 'GRANT')->count());
        $this->assertSame(1, ConsentRecord::where('user_id', $this->user->id)->where('event', 'RECONSENT')->count());
    }

    // ── Withdrawal ───────────────────────────────────────────────────────────

    public function test_withdraw_marketing_then_core(): void
    {
        $this->postJson('/api/me/consent', ['accept_required' => true, 'marketing' => true], $this->auth())->assertCreated();

        $this->postJson('/api/me/consent/withdraw', ['scope' => 'marketing'], $this->auth())
            ->assertOk()
            ->assertJsonPath('data.status.marketing_opt_in', false);

        $this->postJson('/api/me/consent/withdraw', ['scope' => 'CORE'], $this->auth())
            ->assertOk()
            ->assertJsonPath('data.status.core_withdrawn', true)
            ->assertJsonPath('data.status.needs_consent', true);
    }

    // ── Append-only guarantee ────────────────────────────────────────────────

    public function test_consent_records_are_append_only(): void
    {
        $this->postJson('/api/me/consent', ['accept_required' => true], $this->auth())->assertCreated();
        $record = ConsentRecord::where('user_id', $this->user->id)->firstOrFail();

        $this->expectException(\RuntimeException::class);
        $record->update(['marketing_opt_in' => true]);
    }

    // ── Data-subject rights capture ──────────────────────────────────────────

    public function test_data_subject_request_is_captured(): void
    {
        $this->postJson('/api/me/data-requests', ['type' => 'ACCESS'], $this->auth())
            ->assertCreated()
            ->assertJsonPath('data.status', 'RECEIVED');

        $this->assertDatabaseHas('data_subject_requests', [
            'user_id' => $this->user->id,
            'type'    => 'ACCESS',
            'status'  => 'RECEIVED',
        ]);

        $this->postJson('/api/me/data-requests', ['type' => 'INVALID'], $this->auth())->assertStatus(422);
    }
}
