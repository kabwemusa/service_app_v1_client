<?php

namespace Tests\Feature\Provider;

use App\Models\ProviderAvailability;
use App\Models\ProviderProfile;
use App\Models\User;
use App\Services\AvailabilityService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

/**
 * The provider availability API is what makes a provider dispatchable: it
 * writes the provider_availability rows the WhatsApp date-picker and
 * dispatch eligibility read, and mirrors into the legacy profile matrix.
 */
class ProviderAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Redis::flushdb();
    }

    private function provider(): array
    {
        $user = User::findOrCreateByPhone('+260971234567', 'PROVIDER');
        $user->update(['legal_name' => 'Mary Banda', 'phone_verified_at' => now(), 'is_verified' => true]);
        $token = auth('api')->login($user);

        return [$user, ['Authorization' => "Bearer {$token}"]];
    }

    public function test_set_schedule_persists_relational_slots_and_mirrors_matrix(): void
    {
        [$user, $headers] = $this->provider();

        $res = $this->putJson('/api/provider/availability', [
            'slots' => [
                ['day_of_week' => 1, 'start_time' => '08:00', 'end_time' => '17:00'],
                ['day_of_week' => 6, 'start_time' => '09:00', 'end_time' => '13:00'],
            ],
        ], $headers);

        $res->assertOk();
        $this->assertCount(2, $res->json('data.schedule'));

        // Relational rows — the dispatch source of truth.
        $this->assertSame(2, ProviderAvailability::where('provider_id', $user->id)->where('is_recurring', true)->count());

        // Legacy matrix mirrored for older read paths (Hub checklist, conflict check).
        $matrix = ProviderProfile::find($user->id)->availability_matrix;
        $this->assertEquals([['start' => '08:00', 'end' => '17:00']], $matrix['MON']);
        $this->assertEquals([['start' => '09:00', 'end' => '13:00']], $matrix['SAT']);
    }

    public function test_profile_matrix_upsert_bridges_into_relational_slots(): void
    {
        [$user, $headers] = $this->provider();

        $this->putJson('/api/provider/profile', [
            'availability_matrix' => [
                'TUE' => [['start' => '10:00', 'end' => '16:00']],
            ],
        ], $headers)->assertOk();

        $slots = app(AvailabilityService::class)->getSchedule($user->id);
        $this->assertSame([['day_of_week' => 2, 'start_time' => '10:00', 'end_time' => '16:00']], $slots);
    }

    public function test_block_and_unblock_date(): void
    {
        [, $headers] = $this->provider();

        $this->putJson('/api/provider/availability', [
            'slots' => [['day_of_week' => 1, 'start_time' => '08:00', 'end_time' => '17:00']],
        ], $headers)->assertOk();

        $date = now('Africa/Lusaka')->addDays(3)->toDateString();

        $this->postJson('/api/provider/availability/blocks', ['date' => $date], $headers)
            ->assertOk()
            ->assertJsonFragment(['blocked_dates' => [$date]]);

        $this->deleteJson("/api/provider/availability/blocks/{$date}", [], $headers)
            ->assertOk()
            ->assertJsonFragment(['blocked_dates' => []]);
    }

    public function test_blocked_date_removes_slots_from_availability(): void
    {
        [$user, $headers] = $this->provider();

        // Recurring hours every day of the week.
        $slots = [];
        foreach (range(0, 6) as $dow) {
            $slots[] = ['day_of_week' => $dow, 'start_time' => '08:00', 'end_time' => '17:00'];
        }
        $this->putJson('/api/provider/availability', ['slots' => $slots], $headers)->assertOk();

        $date = now('Africa/Lusaka')->addDays(2)->toDateString();
        $this->postJson('/api/provider/availability/blocks', ['date' => $date], $headers)->assertOk();

        $service = app(AvailabilityService::class);
        $this->assertTrue($service->slotsForProvider($user->id, $date)->isEmpty());
        $this->assertFalse($service->slotsForProvider($user->id, now('Africa/Lusaka')->addDays(4)->toDateString())->isEmpty());
    }

    public function test_rejects_inverted_time_windows(): void
    {
        [, $headers] = $this->provider();

        $this->putJson('/api/provider/availability', [
            'slots' => [['day_of_week' => 1, 'start_time' => '17:00', 'end_time' => '08:00']],
        ], $headers)->assertStatus(422);
    }

    public function test_requires_provider_role(): void
    {
        $user = User::findOrCreateByPhone('+260977654321', 'CUSTOMER');
        $user->update(['phone_verified_at' => now(), 'is_verified' => true]);
        $token = auth('api')->login($user);

        $this->getJson('/api/provider/availability', ['Authorization' => "Bearer {$token}"])
            ->assertStatus(403);
    }
}
