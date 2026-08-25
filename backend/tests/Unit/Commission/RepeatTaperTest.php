<?php

namespace Tests\Unit\Commission;

use App\Services\CommissionService;
use Tests\TestCase;

/**
 * Phase 2 §5 — repeat-pair commission taper + buyer-protection waiver.
 *
 * pairBookingNumber() is overridden so the schedule can be exercised without
 * a bookings table; the SQL itself is one COUNT.
 */
class RepeatTaperTest extends TestCase
{
    /**
     * These exercise the fee MECHANISM (rate, cap, repeat taper, admin
     * override) — not the price the platform happens to ship. The default is
     * now 0 because the buyer-protection fee was removed on 2026-08-24, so a
     * non-zero baseline has to be pinned here or there is nothing left to test.
     *
     * CommissionService reads both values in its CONSTRUCTOR, so this must run
     * before the service is resolved.
     */
    protected function setUp(): void
    {
        parent::setUp();

        config([
            'commission.buyer_protection_rate'    => 0.02,
            'commission.buyer_protection_max_zmw' => 50.0,
        ]);
    }

    /** CommissionService with a pinned pair-booking number. */
    private function service(int $pairBookingNumber): CommissionService
    {
        return new class($pairBookingNumber) extends CommissionService
        {
            public function __construct(private readonly int $pinnedNumber)
            {
                parent::__construct();
            }

            public function pairBookingNumber(string $buyerId, string $providerId): int
            {
                return $this->pinnedNumber;
            }
        };
    }

    public function test_taper_schedule(): void
    {
        $svc = $this->service(1);

        // 1st–2nd booking → standard rate
        $this->assertSame(0.0, $svc->repeatTaperDiscount(1));
        $this->assertSame(0.0, $svc->repeatTaperDiscount(2));
        // 3rd–5th → −2 points
        $this->assertSame(0.02, $svc->repeatTaperDiscount(3));
        $this->assertSame(0.02, $svc->repeatTaperDiscount(5));
        // 6th+ → −3 points
        $this->assertSame(0.03, $svc->repeatTaperDiscount(6));
        $this->assertSame(0.03, $svc->repeatTaperDiscount(40));
    }

    public function test_taper_applies_inside_the_breakdown(): void
    {
        // 4th booking between the pair: tier-2 default rate 0.15 − 0.02 = 0.13
        $breakdown = $this->service(4)->calculate(
            gross:      1000.0,
            categoryId: 999999, // no categories table in unit tests → env default rates
            tier:       2,
            providerId: 'prov-1',
            buyerId:    'buyer-1',
        );

        $this->assertSame(0.02, $breakdown['repeat_discount']);
        $this->assertSame(4, $breakdown['pair_booking_number']);
        $this->assertEqualsWithDelta(0.13, $breakdown['effective_rate'], 1e-9);

        // And the discount is visible money: commission on base 985 at 13%
        $this->assertEqualsWithDelta(128.05, $breakdown['commission'], 0.01);
    }

    public function test_first_booking_pays_standard_rate(): void
    {
        $breakdown = $this->service(1)->calculate(
            gross: 1000.0, categoryId: 999999, tier: 2, providerId: 'prov-1', buyerId: 'buyer-1',
        );

        $this->assertSame(0.0, $breakdown['repeat_discount']);
        $this->assertEqualsWithDelta(0.15, $breakdown['effective_rate'], 1e-9);
    }

    public function test_effective_rate_never_goes_negative(): void
    {
        // Even with every discount stacked the rate floors at 0
        $breakdown = $this->service(6)->calculate(
            gross: 100.0, categoryId: 999999, tier: 4, providerId: 'prov-1', buyerId: 'buyer-1',
        );

        $this->assertGreaterThanOrEqual(0.0, $breakdown['effective_rate']);
    }

    public function test_no_buyer_means_no_taper(): void
    {
        $breakdown = $this->service(9)->calculate(
            gross: 1000.0, categoryId: 999999, tier: 2, providerId: 'prov-1', buyerId: null,
        );

        $this->assertSame(0.0, $breakdown['repeat_discount']);
        $this->assertNull($breakdown['pair_booking_number']);
    }

    // ── Buyer-protection waiver ──────────────────────────────────────────────

    public function test_protection_fee_standard_before_third_booking(): void
    {
        // 2% of 1000 = 20, under the ZMW 50 cap; pair number 2 → no waiver
        $this->assertSame(20.0, $this->service(2)->buyerProtectionFee(1000.0, 'buyer-1', 'prov-1'));
    }

    public function test_protection_fee_waived_from_third_booking_capped_at_20(): void
    {
        // Fee 2% of 1000 = 20 → fully waived (waiver cap = 20)
        $this->assertSame(0.0, $this->service(3)->buyerProtectionFee(1000.0, 'buyer-1', 'prov-1'));

        // Fee 2% of 2500 = 50 (at cap) → waiver caps at 20 → buyer pays 30
        $this->assertSame(30.0, $this->service(5)->buyerProtectionFee(2500.0, 'buyer-1', 'prov-1'));

        // Small job: fee 2% of 300 = 6 → waiver = full fee
        $this->assertSame(0.0, $this->service(4)->buyerProtectionFee(300.0, 'buyer-1', 'prov-1'));
    }

    public function test_protection_fee_unchanged_without_pair_context(): void
    {
        $this->assertSame(20.0, $this->service(9)->buyerProtectionFee(1000.0));
    }
}
