<?php

namespace Tests\Unit\Http;

use App\Http\Resources\SearchResultResource;
use Illuminate\Http\Request;
use Tests\TestCase;

/**
 * § SEC-7 — the public search payload must not leak a provider's precise
 * coordinates or the internal ranking signal (sort_score). Clients get a
 * distance + a location label only.
 */
class SearchResultResourceTest extends TestCase
{
    private function candidate(): object
    {
        return (object) [
            'id' => 'svc-1', 'provider_id' => 'prov-1',
            'cat_id' => 1, 'category_name' => 'Cleaning', 'cat_icon' => null,
            'title' => 'Deep clean', 'description' => 'x', 'pricing_model' => 'OUTCOME_FIXED',
            'delivery_type' => 'IN_PERSON', 'base_location_label' => 'Kabulonga, Lusaka',
            'base_price' => 300, 'latitude' => -15.39, 'longitude' => 28.32,
            'distance_m' => 4200, 'has_promo_slot' => false, 'placement' => 'organic',
            'completed_job_count' => 12, 'display_name' => 'Jane', 'avatar_url' => null,
            'r_raw' => 4.6, 'r_bayes' => 4.5, 'v_reviews' => 20, 'completion_rate' => 0.9,
            'trust_tier' => 2, 'response_time_p50_mins' => 30, 'photo_urls' => '[]',
            'sort_score' => 0.87,
        ];
    }

    public function test_coordinates_and_sort_score_are_not_exposed(): void
    {
        $array = (new SearchResultResource($this->candidate()))->toArray(Request::create('/'));

        $this->assertArrayNotHasKey('latitude', $array);
        $this->assertArrayNotHasKey('longitude', $array);
        $this->assertArrayNotHasKey('sort_score', $array);

        // The provider sub-array must not carry coordinates either.
        $this->assertArrayNotHasKey('latitude', $array['provider']);
        $this->assertArrayNotHasKey('longitude', $array['provider']);
    }

    public function test_distance_and_label_are_still_present(): void
    {
        $array = (new SearchResultResource($this->candidate()))->toArray(Request::create('/'));

        $this->assertSame(4.2, $array['distance_km']);
        $this->assertSame('Kabulonga, Lusaka', $array['location_label']);
    }
}
