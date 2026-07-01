<?php

namespace Tests\Unit\Location;

use App\Services\Location\GazetteerService;
use App\Services\Location\GeocodingService;
use Illuminate\Support\Facades\Http;
use Mockery;
use Tests\TestCase;

/**
 * Layered orchestration (v3.2 §3.1, Workstream C): gazetteer → photon → google
 * for forward, and reverse-snapping against the gazetteer. The gazetteer is a
 * Mockery mock so these run without a database; all HTTP is faked.
 */
class GeocodingOrchestrationTest extends TestCase
{
    private function usePhotonChain(): void
    {
        config([
            'location.geocoding.driver'        => 'photon',
            'location.geocoding.forward_chain' => [],        // derive ['photon','google']
            'location.geocoding.photon.base_url' => 'http://localhost:2322',
            'location.geocoding.google.key'    => 'test-key',
        ]);
    }

    public function test_confident_gazetteer_match_short_circuits_photon(): void
    {
        config([
            'location.geocoding.driver'                  => 'photon',
            'location.geocoding.gazetteer_short_circuit' => true,
        ]);

        Http::fake(); // any outgoing HTTP would be recorded

        $gazetteer = Mockery::mock(GazetteerService::class);
        $gazetteer->shouldReceive('matches')->once()->with('kabwata', 5)->andReturn([[
            'label'           => 'Kabwata Site & Service',
            'place_name'      => 'Kabwata Site & Service',
            'region_province' => 'Lusaka Province',
            'region_ward'     => 'Kabwata',
            'lat'             => -15.428,
            'lng'             => 28.302,
            'gazetteer'       => true,
        ]]);

        $results = (new GeocodingService($gazetteer))->search('kabwata');

        $this->assertCount(1, $results);
        $this->assertTrue($results[0]['gazetteer']);
        $this->assertSame('gazetteer', $results[0]['source']);

        // The whole point: no external driver was touched.
        Http::assertNothingSent();
    }

    public function test_photon_miss_falls_through_to_google(): void
    {
        $this->usePhotonChain();

        Http::fake([
            // Photon returns nothing → the chain must continue to Google.
            'localhost:2322/*' => Http::response(['type' => 'FeatureCollection', 'features' => []]),
            'maps.googleapis.com/maps/api/place/autocomplete/*' => Http::response([
                'predictions' => [['place_id' => 'PID-1']],
            ]),
            'maps.googleapis.com/maps/api/place/details/*' => Http::response([
                'result' => [
                    'name'               => 'Levy Junction Mall',
                    'formatted_address'  => 'Church Rd, Lusaka',
                    'geometry'           => ['location' => ['lat' => -15.4087, 'lng' => 28.2925]],
                    'address_components' => [
                        ['types' => ['administrative_area_level_1'], 'long_name' => 'Lusaka Province'],
                        ['types' => ['sublocality'], 'long_name' => 'Rhodes Park'],
                    ],
                ],
            ]),
        ]);

        $gazetteer = Mockery::mock(GazetteerService::class);
        $gazetteer->shouldReceive('matches')->once()->andReturn([]); // no local hit

        $results = (new GeocodingService($gazetteer))->search('levy mall');

        $this->assertCount(1, $results);
        $this->assertSame('google', $results[0]['source']);
        $this->assertFalse($results[0]['gazetteer']);
        $this->assertSame('Levy Junction Mall, Rhodes Park', $results[0]['label']);

        // Photon WAS attempted first, then Google answered.
        Http::assertSent(fn ($request) => str_contains($request->url(), 'localhost:2322/api'));
        Http::assertSent(fn ($request) => str_contains($request->url(), 'maps.googleapis.com'));
    }

    public function test_reverse_snaps_region_to_gazetteer_canonical(): void
    {
        config([
            'location.geocoding.driver'        => 'photon',
            'location.geocoding.reverse_snap'  => true,
            'location.geocoding.photon.base_url' => 'http://localhost:2322',
        ]);

        Http::fake(['localhost:2322/*' => Http::response([
            'type'     => 'FeatureCollection',
            'features' => [[
                'geometry'   => ['coordinates' => [28.3001, -15.4221]],
                'properties' => [
                    'name'     => 'Some OSM Name',
                    // Raw OSM admin names we deliberately distrust:
                    'district' => 'Raw OSM Ward',
                    'state'    => 'Raw OSM Province',
                ],
            ]],
        ])]);

        $gazetteer = Mockery::mock(GazetteerService::class);
        $gazetteer->shouldReceive('regionFor')->once()->andReturn([
            'region_province' => 'Lusaka Province',
            'region_ward'     => 'Kabwata',
        ]);

        $result = (new GeocodingService($gazetteer))->reverseGeocode(-15.4221, 28.3001);

        $this->assertNotNull($result);
        // Snapped to the gazetteer's canonical values, not the raw OSM names.
        $this->assertSame('Lusaka Province', $result['region_province']);
        $this->assertSame('Kabwata', $result['region_ward']);
    }
}
