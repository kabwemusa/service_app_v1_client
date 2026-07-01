<?php

namespace Tests\Unit\Location;

use App\Services\Location\Drivers\PhotonDriver;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Photon driver — GeoJSON parse, the [lon,lat] → {lat,lng} normalisation
 * (a deliberate swap MUST fail), error/empty semantics, and that every request
 * carries the Zambia query tuning (bbox, lang, bias, layer). All HTTP mocked —
 * the suite passes with no Photon instance running.
 */
class PhotonDriverTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Deterministic Zambia tuning regardless of the environment's .env.
        config([
            'location.geocoding.photon.base_url'          => 'http://localhost:2322',
            'location.geocoding.photon.bbox'              => '21.99,-18.08,33.71,-8.22',
            'location.geocoding.photon.lang'              => 'en',
            'location.geocoding.photon.limit'             => 5,
            'location.geocoding.photon.timeout'           => 5,
            'location.geocoding.photon.bias_scale'        => 0.7,
            'location.geocoding.photon.zoom'              => null,
            'location.geocoding.photon.fallback_lat'      => -15.4167,
            'location.geocoding.photon.fallback_lon'      => 28.2833,
            'location.geocoding.photon.layers'            => ['city', 'locality', 'district', 'street'],
            'location.geocoding.photon.reverse_radius_km' => 3,
        ]);
    }

    private function forwardCollection(): array
    {
        return [
            'type'     => 'FeatureCollection',
            'features' => [[
                'type'       => 'Feature',
                // GeoJSON order is [lon, lat] — lon first, lat second.
                'geometry'   => ['type' => 'Point', 'coordinates' => [28.2871, -15.4194]],
                'properties' => [
                    'name'     => 'Kabwata Market',
                    'street'   => 'Burma Road',
                    'city'     => 'Lusaka',
                    'district' => 'Kabwata',
                    'state'    => 'Lusaka Province',
                    'country'  => 'Zambia',
                ],
            ]],
        ];
    }

    public function test_forward_parses_geojson_into_candidate_shape(): void
    {
        Http::fake(['localhost:2322/*' => Http::response($this->forwardCollection())]);

        $results = (new PhotonDriver())->search('kabwata');

        $this->assertCount(1, $results);
        $r = $results[0];

        $this->assertSame('Kabwata Market, Lusaka', $r['label']);
        $this->assertSame('Kabwata Market, Burma Road, Lusaka, Lusaka Province, Zambia', $r['place_name']);
        $this->assertSame('Lusaka Province', $r['region_province']);
        $this->assertSame('Kabwata', $r['region_ward']);
    }

    public function test_forward_maps_lon_lat_to_lat_lng_and_a_swap_would_fail(): void
    {
        Http::fake(['localhost:2322/*' => Http::response($this->forwardCollection())]);

        $r = (new PhotonDriver())->search('kabwata')[0];

        // coordinates were [28.2871, -15.4194] = [lon, lat].
        $this->assertEqualsWithDelta(-15.4194, $r['lat'], 1e-9);
        $this->assertEqualsWithDelta(28.2871, $r['lng'], 1e-9);

        // Explicit guard: Zambia latitude is negative, longitude positive.
        // If the driver ever swapped the pair, both of these flip and fail.
        $this->assertLessThan(0, $r['lat']);
        $this->assertGreaterThan(0, $r['lng']);
        $this->assertNotEqualsWithDelta($r['lat'], $r['lng'], 1e-9);
    }

    public function test_reverse_parses_feature_and_preserves_queried_coords(): void
    {
        Http::fake(['localhost:2322/*' => Http::response([
            'type'     => 'FeatureCollection',
            'features' => [[
                'geometry'   => ['coordinates' => [28.2871, -15.4194]],
                'properties' => [
                    'name'     => 'Kabwata',
                    'district' => 'Kabwata',
                    'state'    => 'Lusaka Province',
                    'country'  => 'Zambia',
                ],
            ]],
        ])]);

        $result = (new PhotonDriver())->reverse(-15.41675, 28.28335);

        $this->assertNotNull($result);
        $this->assertSame('Lusaka Province', $result['region_province']);
        $this->assertSame('Kabwata', $result['region_ward']);
        // Reverse keeps the EXACT coordinates queried; only the label is feature-derived.
        $this->assertSame(-15.41675, $result['lat']);
        $this->assertSame(28.28335, $result['lng']);
    }

    public function test_forward_request_carries_zambia_tuning(): void
    {
        Http::fake(['localhost:2322/*' => Http::response($this->forwardCollection())]);

        (new PhotonDriver())->search('kabwata');

        Http::assertSent(function ($request) {
            $url = urldecode($request->url());

            return str_contains($url, '/api?')
                && str_contains($url, 'bbox=21.99,-18.08,33.71,-8.22')
                && str_contains($url, 'lang=en')
                && str_contains($url, 'limit=5')
                && str_contains($url, 'location_bias_scale=0.7')
                // No device coords supplied ⇒ biased to the Lusaka fallback centre.
                && str_contains($url, 'lat=-15.4167')
                && str_contains($url, 'lon=28.2833')
                // Layer filter sent as repeated keys, not layer[]=…
                && str_contains($url, 'layer=city')
                && str_contains($url, 'layer=street')
                && ! str_contains($url, 'layer%5B');
        });
    }

    public function test_forward_biases_to_supplied_device_coords(): void
    {
        Http::fake(['localhost:2322/*' => Http::response($this->forwardCollection())]);

        // Kitwe-ish device fix — should override the Lusaka fallback.
        (new PhotonDriver())->search('shoprite', 5, null, ['lat' => -12.8024, 'lng' => 28.2132]);

        Http::assertSent(function ($request) {
            $url = urldecode($request->url());

            return str_contains($url, 'lat=-12.8024')
                && str_contains($url, 'lon=28.2132')
                && ! str_contains($url, 'lat=-15.4167');
        });
    }

    public function test_empty_feature_collection_returns_no_results(): void
    {
        Http::fake(['localhost:2322/*' => Http::response(['type' => 'FeatureCollection', 'features' => []])]);

        $this->assertSame([], (new PhotonDriver())->search('nowhere'));
        $this->assertNull((new PhotonDriver())->reverse(-15.0, 28.0));
    }

    public function test_http_error_status_returns_no_results(): void
    {
        Http::fake(['localhost:2322/*' => Http::response('', 502)]);

        $this->assertSame([], (new PhotonDriver())->search('kabwata'));
    }

    public function test_timeout_is_swallowed_and_returns_no_results(): void
    {
        Http::fake(['localhost:2322/*' => fn () => throw new ConnectionException('timed out')]);

        // Must NOT throw — the orchestrator falls through on an empty outcome.
        $this->assertSame([], (new PhotonDriver())->search('kabwata'));
        $this->assertNull((new PhotonDriver())->reverse(-15.0, 28.0));
    }
}
