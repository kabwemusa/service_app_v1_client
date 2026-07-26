<?php

namespace Tests\Feature\Performance;

use App\Models\Category;
use App\Models\ProviderProfile;
use App\Models\User;
use App\Services\CommissionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * § DB-5 — CommissionService memoizes per-request lookups (pair-count,
 * subscription, tier rate) so pricing many bookings for one provider doesn't
 * issue a query per row.
 */
class CommissionMemoizationTest extends TestCase
{
    use RefreshDatabase;

    public function test_pair_count_is_queried_once_per_pair(): void
    {
        $buyer    = User::create(['legal_name' => 'B', 'phone' => '+260972222222', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);
        $provider = User::create(['legal_name' => 'P', 'phone' => '+260971111111', 'role' => 'PROVIDER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);

        $commission = app(CommissionService::class);

        DB::enableQueryLog();
        // Ten calls for the same (buyer, provider) pair — as incomingRequests would
        // do while pricing ten of that buyer's requests.
        for ($i = 0; $i < 10; $i++) {
            $commission->pairBookingNumber($buyer->id, $provider->id);
        }
        $countQueries = collect(DB::getQueryLog())
            ->filter(fn ($q) => str_contains($q['query'], 'bookings') && str_contains(strtolower($q['query']), 'count'))
            ->count();
        DB::disableQueryLog();

        $this->assertSame(1, $countQueries, 'pair count should be memoized after the first query');
    }

    public function test_calculate_prices_many_bookings_with_bounded_queries(): void
    {
        $category = Category::create(['name' => 'D', 'slug' => 'd', 'is_active' => true, 'risk_tier' => 1, 'display_order' => 1]);
        $provider = User::create(['legal_name' => 'P', 'phone' => '+260971111111', 'role' => 'PROVIDER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);
        ProviderProfile::create(['user_id' => $provider->id, 'trust_tier' => 2, 'display_name' => 'P']);
        $buyer = User::create(['legal_name' => 'B', 'phone' => '+260972222222', 'role' => 'CUSTOMER', 'account_state' => 'ACTIVE', 'password_hash' => Hash::make('x')]);

        $commission = app(CommissionService::class);

        DB::enableQueryLog();
        for ($i = 0; $i < 20; $i++) {
            $commission->calculate(gross: 500, categoryId: $category->id, tier: 2, providerId: $provider->id, buyerId: $buyer->id);
        }
        $n = count(DB::getQueryLog());
        DB::disableQueryLog();

        // With memoization the 20 identical prices share one subscription + one
        // tier-rate + one pair-count query — a small constant, not ~60.
        $this->assertLessThanOrEqual(5, $n, "expected bounded queries, got {$n}");
    }
}
