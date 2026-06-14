<?php

namespace Tests\Unit\Location;

use App\Services\BookingConflictService;
use App\Support\Geohash;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Phase 1 — §3.2 geohash codec and §1.6 transit feasibility math.
 */
class GeohashAndTransitTest extends TestCase
{
    // ── Geohash ──────────────────────────────────────────────────────────────

    public function test_encode_matches_reference_vectors(): void
    {
        // Classic reference vectors
        $this->assertSame('u4pruy', Geohash::encode(57.64911, 10.40744, 6));
        $this->assertSame('u4pruydqqvj', Geohash::encode(57.64911, 10.40744, 11));
        $this->assertSame('ezs42', Geohash::encode(42.605, -5.603, 5));
    }

    public function test_decode_round_trip_stays_within_the_cell(): void
    {
        $lat = -15.4167;
        $lng = 28.2833;

        $decoded = Geohash::decode(Geohash::encode($lat, $lng, 6));

        // Geohash-6 cell ≈ 1.2 km × 0.6 km → centroid within half a cell
        $this->assertEqualsWithDelta($lat, $decoded['lat'], 0.003);
        $this->assertEqualsWithDelta($lng, $decoded['lng'], 0.006);
    }

    public function test_precision_5_is_a_prefix_of_precision_6(): void
    {
        $h6 = Geohash::encode(-15.4167, 28.2833, 6);
        $h5 = Geohash::encode(-15.4167, 28.2833, 5);

        $this->assertSame(substr($h6, 0, 5), $h5);
    }

    // ── §1.6 transit feasibility ─────────────────────────────────────────────

    private function transitService(): BookingConflictService
    {
        return new BookingConflictService();
    }

    public function test_off_peak_uses_30_kmh_with_circuity(): void
    {
        // 10 km straight-line at midday: 10 × 1.35 = 13.5 road-km
        // at 30 km/h = 27 min + 15 min buffer = 42 min
        $departure = Carbon::parse('2026-06-11 13:00', 'Africa/Lusaka');

        $this->assertEqualsWithDelta(
            42.0,
            $this->transitService()->requiredTransitMinutes(10.0, $departure),
            1e-6,
        );
    }

    public function test_peak_drops_to_20_kmh(): void
    {
        // Same trip departing 07:30: 13.5 km at 20 km/h = 40.5 min + 15 = 55.5
        $morningPeak = Carbon::parse('2026-06-11 07:30', 'Africa/Lusaka');
        $eveningPeak = Carbon::parse('2026-06-11 17:00', 'Africa/Lusaka');

        $this->assertEqualsWithDelta(55.5, $this->transitService()->requiredTransitMinutes(10.0, $morningPeak), 1e-6);
        $this->assertEqualsWithDelta(55.5, $this->transitService()->requiredTransitMinutes(10.0, $eveningPeak), 1e-6);
    }

    public function test_peak_window_boundaries(): void
    {
        $svc = $this->transitService();

        $justBeforePeak = Carbon::parse('2026-06-11 06:29', 'Africa/Lusaka');
        $peakStart      = Carbon::parse('2026-06-11 06:30', 'Africa/Lusaka');
        $peakEnd        = Carbon::parse('2026-06-11 09:00', 'Africa/Lusaka'); // exclusive

        $this->assertLessThan(
            $svc->requiredTransitMinutes(10.0, $peakStart),
            $svc->requiredTransitMinutes(10.0, $justBeforePeak),
        );
        $this->assertEqualsWithDelta(
            $svc->requiredTransitMinutes(10.0, $justBeforePeak),
            $svc->requiredTransitMinutes(10.0, $peakEnd),
            1e-6,
        );
    }
}
