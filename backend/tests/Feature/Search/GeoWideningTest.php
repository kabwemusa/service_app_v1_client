<?php

namespace Tests\Feature\Search;

use App\Models\Category;
use App\Models\ProviderProfile;
use App\Models\Service;
use App\Models\User;
use App\Services\SearchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * v3.1 §4.4 — candidacy widens by region tier (area → city → province →
 * national) instead of a distance radius, and the feed is never empty for
 * geography alone: it widens until it finds providers, only reaching national
 * once the province is exhausted. Region columns are seeded directly
 * (SEARCH_AUTO_RESOLVE_REGIONS=false in the test env — no geocoder calls).
 */
class GeoWideningTest extends TestCase
{
    use RefreshDatabase;

    private Category $category;

    protected function setUp(): void
    {
        parent::setUp();

        $this->category = Category::create([
            'name' => 'Plumbing', 'slug' => 'plumbing', 'is_active' => true,
            'risk_tier' => 3, 'display_order' => 1,
        ]);

        // Four services across the region hierarchy (all in the same category).
        $this->makeProvider('Kabwata Ken',  'Kabwata',      'Lusaka', 'Lusaka Province');
        $this->makeProvider('Chelstone Cho','Chelstone',    'Lusaka', 'Lusaka Province');
        $this->makeProvider('Kabwe Kay',    'Kabwe Central','Kabwe',  'Central Province');
        $this->makeProvider('Ndola Ndhlovu','Kansenshi',    'Ndola',  'Copperbelt Province');
    }

    /** Delivery in Kabwata with a ward-level match → tightest tier only. */
    public function test_ward_match_returns_only_the_area_tier(): void
    {
        config(['search.geo.widen_target' => 1]);

        $titles = $this->searchTitles([
            'region'      => 'Lusaka Province',
            'region_city' => 'Lusaka',
            'region_ward' => 'Kabwata',
        ]);

        $this->assertEquals(['Kabwata Ken'], $titles);
    }

    /** No provider in the delivery ward → widen to the city, never empty. */
    public function test_widens_area_to_city_when_ward_empty(): void
    {
        config(['search.geo.widen_target' => 1]);

        $titles = $this->searchTitles([
            'region'      => 'Lusaka Province',
            'region_city' => 'Lusaka',
            'region_ward' => 'Nowhere Compound', // no provider here
        ]);

        // Both Lusaka-city services surface; other provinces stay out.
        sort($titles);
        $this->assertEquals(['Chelstone Cho', 'Kabwata Ken'], $titles);
    }

    /** No ward/city match → widen to the province. */
    public function test_widens_to_province(): void
    {
        config(['search.geo.widen_target' => 1]);

        $titles = $this->searchTitles([
            'region'      => 'Lusaka Province',
            'region_city' => 'Nowhere City',
            'region_ward' => 'Nowhere Compound',
        ]);

        sort($titles);
        $this->assertEquals(['Chelstone Cho', 'Kabwata Ken'], $titles);
    }

    /**
     * A province with zero providers must NOT show an empty state — it widens
     * all the way to national and returns everyone, flagged as a fallback.
     */
    public function test_empty_province_widens_to_national_never_empty(): void
    {
        config(['search.geo.widen_target' => 1]);

        $result = app(SearchService::class)->search([
            'category_id' => $this->category->id,
            'lat' => -15.4, 'lng' => 28.3,
            'region'      => 'Western Province',   // no providers anywhere here
            'region_city' => 'Mongu',
            'region_ward' => 'Mongu Central',
        ]);

        $this->assertCount(4, $result['data']);   // national — nobody is hidden
        $this->assertTrue($result['fallback']);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** @return array<int, string> service titles in the returned order */
    private function searchTitles(array $regionParams): array
    {
        $result = app(SearchService::class)->search(array_merge([
            'category_id' => $this->category->id,
            'lat' => -15.4, 'lng' => 28.3,
        ], $regionParams));

        return array_map(fn ($row) => $row->title, $result['data']);
    }

    private function makeProvider(string $title, string $ward, string $city, string $province): void
    {
        $user = User::create([
            'legal_name' => $title, 'email' => strtolower(str_replace(' ', '', $title)) . '@test.zm',
            'phone' => '+26097' . random_int(1000000, 9999999),
            'role' => 'PROVIDER', 'account_state' => 'ACTIVE',
            'password_hash' => Hash::make('test'),
        ]);

        ProviderProfile::create([
            'user_id' => $user->id,
            'trust_tier' => 2,
            'trust_score' => 0.80,
            'profile_completeness' => 60,
            'accepting_bookings' => true,
            'display_name' => $title,
            'base_location_lat' => -15.41,
            'base_location_lng' => 28.30,
        ]);

        $service = Service::create([
            'title' => $title, 'category_id' => $this->category->id,
            'status' => 'ACTIVE', 'base_price' => 150, 'pricing_model' => 'FIXED',
            'provider_id' => $user->id,
        ]);

        // Seed the service location + region hierarchy directly (no geocoder).
        DB::statement(
            'UPDATE services
                SET service_location = ST_GeogFromText(?),
                    region_ward = ?, region_city = ?, region_province = ?
              WHERE id = ?',
            ['POINT(28.30 -15.41)', $ward, $city, $province, $service->id],
        );
    }
}
