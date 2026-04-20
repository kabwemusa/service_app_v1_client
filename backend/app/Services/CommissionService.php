<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\Commission;
use App\Models\Subscription;
use Illuminate\Support\Facades\Log;

/**
 * Commission engine — §8.2
 *
 * commission_base  = gross - processor_fee
 * effective_rate   = max(0, tier_rate - subscription_discount - promo_discount)
 * commission       = commission_base * effective_rate
 * vat              = commission * 0.16
 * net_to_provider  = commission_base - commission - vat
 */
class CommissionService
{
    private float $vatRate;
    private float $processorFeePct;
    private float $buyerProtectionRate;
    private float $buyerProtectionMaxZmw;
    private float $defaultTier1Rate;
    private float $defaultTier2Rate;
    private float $defaultTier3Rate;
    private float $defaultTier4Rate;

    public function __construct()
    {
        $this->vatRate               = (float) env('PLATFORM_VAT_RATE',         0.16);
        $this->processorFeePct       = (float) env('MOMO_PROCESSOR_FEE_PCT',    0.015);
        $this->buyerProtectionRate   = (float) env('BUYER_PROTECTION_RATE',     0.02);
        $this->buyerProtectionMaxZmw = (float) env('BUYER_PROTECTION_MAX_ZMW',  50.0);
        $this->defaultTier1Rate      = (float) env('DEFAULT_COMMISSION_TIER1',  0.18);
        $this->defaultTier2Rate      = (float) env('DEFAULT_COMMISSION_TIER2',  0.15);
        $this->defaultTier3Rate      = (float) env('DEFAULT_COMMISSION_TIER3',  0.13);
        $this->defaultTier4Rate      = (float) env('DEFAULT_COMMISSION_TIER4',  0.11);
    }

    /**
     * Calculate and persist the commission record for a completed booking.
     * Called inside BookingService::complete() within the same DB transaction.
     *
     * @return Commission
     */
    public function record(Booking $booking): Commission
    {
        $breakdown = $this->calculate(
            gross:        (float) $booking->amount,
            categoryId:   (int)   $booking->service->category_id,
            tier:         (int)   ($booking->provider->providerProfile->trust_tier ?? 1),
            providerId:   $booking->provider_id,
        );

        return Commission::create([
            'booking_id'           => $booking->id,
            'provider_id'          => $booking->provider_id,
            'category_id'          => $booking->service->category_id,
            'gross_amount'         => $breakdown['gross'],
            'commission_rate'      => $breakdown['effective_rate'],
            'commission_amount'    => $breakdown['commission'],
            'vat'                  => $breakdown['vat'],
            'net_to_provider'      => $breakdown['net_to_provider'],
            'tier_at_time'         => $breakdown['tier'],
            'calculated_at'        => now(),
        ]);
    }

    /**
     * Recalculate commission after a partial refund.
     * Updates the existing commission row with adjusted values.
     */
    public function recalculateForPartialRefund(Commission $commission, float $refundAmount): void
    {
        $retainedGross = $commission->gross_amount - $refundAmount;

        if ($retainedGross <= 0) {
            $commission->update([
                'gross_amount'      => 0,
                'commission_amount' => 0,
                'vat'               => 0,
                'net_to_provider'   => 0,
            ]);
            return;
        }

        $processorFee    = round($retainedGross * $this->processorFeePct, 2);
        $base            = $retainedGross - $processorFee;
        $commissionAmt   = round($base * $commission->commission_rate, 2);
        $vat             = round($commissionAmt * $this->vatRate, 2);
        $net             = round($base - $commissionAmt - $vat, 2);

        $commission->update([
            'gross_amount'      => $retainedGross,
            'commission_amount' => $commissionAmt,
            'vat'               => $vat,
            'net_to_provider'   => max(0.0, $net),
        ]);
    }

    /**
     * Calculate the buyer protection fee for a booking amount.
     * 2% capped at ZMW 50.
     */
    public function buyerProtectionFee(float $gross): float
    {
        return min($this->buyerProtectionMaxZmw, round($gross * $this->buyerProtectionRate, 2));
    }

    /**
     * Pure calculation — returns the full breakdown without persisting.
     */
    public function calculate(
        float  $gross,
        int    $categoryId,
        int    $tier,
        string $providerId,
    ): array {
        $tierRate            = $this->tierRate($categoryId, $tier);
        $subscriptionDiscount = $this->subscriptionDiscount($providerId);
        $effectiveRate       = max(0.0, $tierRate - $subscriptionDiscount);
        $processorFee        = round($gross * $this->processorFeePct, 2);
        $base                = $gross - $processorFee;
        $commission          = round($base * $effectiveRate, 2);
        $vat                 = round($commission * $this->vatRate, 2);
        $net                 = round($base - $commission - $vat, 2);

        return [
            'gross'             => $gross,
            'processor_fee'     => $processorFee,
            'commission_base'   => $base,
            'tier_rate'         => $tierRate,
            'subscription_disc' => $subscriptionDiscount,
            'effective_rate'    => $effectiveRate,
            'commission'        => $commission,
            'vat'               => $vat,
            'net_to_provider'   => max(0.0, $net),
            'tier'              => $tier,
        ];
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function tierRate(int $categoryId, int $tier): float
    {
        try {
            $category = \App\Models\Category::find($categoryId);
            if ($category && $category->commission_rates) {
                $rates = is_array($category->commission_rates)
                    ? $category->commission_rates
                    : json_decode($category->commission_rates, true);

                if (isset($rates[(string) $tier])) {
                    return (float) $rates[(string) $tier];
                }
            }
        } catch (\Throwable $e) {
            Log::warning('CommissionService::tierRate fallback', ['error' => $e->getMessage()]);
        }

        return match($tier) {
            1       => $this->defaultTier1Rate,
            2       => $this->defaultTier2Rate,
            3       => $this->defaultTier3Rate,
            default => $this->defaultTier4Rate,
        };
    }

    private function subscriptionDiscount(string $providerId): float
    {
        try {
            $sub = Subscription::where('provider_id', $providerId)
                ->where('status', 'ACTIVE')
                ->latest('current_period_start')
                ->first();

            if (! $sub) return 0.0;

            return match($sub->plan) {
                'PRO'   => (float) env('SUBSCRIPTION_PRO_DISCOUNT',   0.02),
                'ELITE' => (float) env('SUBSCRIPTION_ELITE_DISCOUNT',  0.04),
                default => 0.0,
            };
        } catch (\Throwable) {
            return 0.0;
        }
    }
}
