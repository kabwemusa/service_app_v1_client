<?php

namespace App\Services\Growth;

use App\Events\PlacementChanged;
use App\Models\Booking;
use App\Models\Campaign;
use App\Models\CampaignLedgerEntry;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Applies a customer campaign discount at checkout.
 *
 * Invariants (the whole point of the feature):
 *   • The PROVIDER IS PAID IN FULL — provider_split_zmw is never reduced. The
 *     discount comes out of Sebenza's take (commission_split_zmw) or the buyer
 *     protection fee, and is booked as marketing spend against the campaign.
 *   • Budget is a hard cap — the decrement is a single conditional UPDATE, so a
 *     campaign can never overspend, even under concurrent checkouts.
 *   • Idempotent — UNIQUE(campaign_id, booking_id) plus an up-front replay check
 *     means a double-tap or gateway retry can't double-apply or double-decrement.
 *
 * apply() MUST be called inside the caller's booking DB transaction so the
 * discount, the ledger row, and the booking's money fields commit atomically.
 */
class CampaignDiscountService
{
    public function __construct(private readonly AudienceResolver $audience) {}

    /**
     * Non-mutating preview for the checkout screen. Returns the breakdown the
     * customer will see, or null when nothing applies. Never decrements budget.
     *
     * @return array{campaign_id:string,name:string,offer_type:string,discount_zmw:float,reduces_fee:bool}|null
     */
    public function preview(Booking $booking, ?string $code, User $buyer): ?array
    {
        $campaign = $this->resolveApplicable($booking, $code, $buyer);
        if (! $campaign) {
            return null;
        }
        $discount = $this->computeDiscount($campaign, $booking);
        if ($discount <= 0) {
            return null;
        }
        return [
            'campaign_id' => $campaign->id,
            'name'        => $campaign->name,
            'offer_type'  => $campaign->offer_type,
            'discount_zmw' => $discount,
            'reduces_fee' => $campaign->offer_type === 'FREE_SERVICE_FEE',
        ];
    }

    /**
     * Resolve, budget-guard, record, and return the discount to apply to this
     * booking. Returns a zero-discount result when nothing applies or the cap is
     * hit (the caller then charges full price — never an error).
     *
     * Deposit holds (QUOTE_DEPOSIT first phase) are not discounted this phase.
     *
     * @return array{campaign_id:?string,discount_zmw:float,reduces_fee:bool}
     */
    public function apply(Booking $booking, ?string $code, User $buyer, bool $isDepositHold = false): array
    {
        $none = ['campaign_id' => null, 'discount_zmw' => 0.0, 'reduces_fee' => false];

        if ($isDepositHold) {
            return $none;
        }

        $campaign = $this->resolveApplicable($booking, $code, $buyer);
        if (! $campaign) {
            return $none;
        }

        // Idempotent replay: this booking already redeemed this campaign — return
        // the recorded discount without touching the budget again.
        $existing = CampaignLedgerEntry::where('campaign_id', $campaign->id)
            ->where('booking_id', $booking->id)
            ->first();
        if ($existing) {
            return [
                'campaign_id' => $campaign->id,
                'discount_zmw' => (float) $existing->amount_zmw,
                'reduces_fee' => $campaign->offer_type === 'FREE_SERVICE_FEE',
            ];
        }

        $discount = $this->computeDiscount($campaign, $booking);
        if ($discount <= 0) {
            return $none;
        }

        // Atomic budget + uses guard. 0 rows affected ⇒ cap/uses exhausted ⇒ no
        // discount (customer charged full price). Never overspends the cap.
        $affected = DB::update(
            "UPDATE campaigns
                SET budget_spent = budget_spent + ?, total_uses = total_uses + 1
              WHERE id = ?
                AND status = 'LIVE'
                AND (budget_cap IS NULL OR budget_spent + ? <= budget_cap)
                AND (total_uses_cap IS NULL OR total_uses < total_uses_cap)",
            [$discount, $campaign->id, $discount],
        );

        if ($affected === 0) {
            $this->markExhaustedIfNeeded($campaign->id);
            return $none;
        }

        // Record the redemption / spend. insertOrIgnore is the concurrency
        // backstop: if a racing checkout for the SAME booking won the unique
        // constraint, reverse our decrement and defer to it.
        $inserted = CampaignLedgerEntry::query()->insertOrIgnore([
            'id'          => (string) \Illuminate\Support\Str::uuid(),
            'campaign_id' => $campaign->id,
            'user_id'     => $buyer->id,
            'booking_id'  => $booking->id,
            'kind'        => 'CUSTOMER_DISCOUNT',
            'amount_zmw'  => $discount,
            'created_at'  => now(),
        ]);

        if ($inserted === 0) {
            DB::update(
                'UPDATE campaigns SET budget_spent = budget_spent - ?, total_uses = total_uses - 1 WHERE id = ?',
                [$discount, $campaign->id],
            );
            return $none;
        }

        $this->markExhaustedIfNeeded($campaign->id);

        return [
            'campaign_id' => $campaign->id,
            'discount_zmw' => $discount,
            'reduces_fee' => $campaign->offer_type === 'FREE_SERVICE_FEE',
        ];
    }

    /**
     * Async settle path: the discount was decided and stamped on the booking at
     * gateway initiation (the customer was already charged the reduced amount);
     * this records the spend once funds settle. Idempotent + budget-guarded, but
     * best-effort — an in-flight booking that just crosses the cap is still
     * recorded (the customer was already charged reduced, provider paid in full).
     */
    public function recordReserved(Booking $booking): void
    {
        if (! $booking->campaign_id || (float) $booking->campaign_discount_zmw <= 0) {
            return;
        }

        $exists = CampaignLedgerEntry::where('campaign_id', $booking->campaign_id)
            ->where('booking_id', $booking->id)
            ->exists();
        if ($exists) {
            return;
        }

        $discount = (float) $booking->campaign_discount_zmw;

        DB::update(
            'UPDATE campaigns SET budget_spent = budget_spent + ?, total_uses = total_uses + 1 WHERE id = ?',
            [$discount, $booking->campaign_id],
        );

        CampaignLedgerEntry::query()->insertOrIgnore([
            'id'          => (string) \Illuminate\Support\Str::uuid(),
            'campaign_id' => $booking->campaign_id,
            'user_id'     => $booking->buyer_id,
            'booking_id'  => $booking->id,
            'kind'        => 'CUSTOMER_DISCOUNT',
            'amount_zmw'  => $discount,
            'created_at'  => now(),
        ]);

        $this->markExhaustedIfNeeded($booking->campaign_id);
    }

    /**
     * The single eligibility gate — used by both preview() and apply(). A
     * campaign applies only if it is currently live, targets checkout, the user
     * is in the audience (evaluated against the booking's category/area), and the
     * per-user cap is not exceeded.
     */
    public function resolveApplicable(Booking $booking, ?string $code, User $buyer): ?Campaign
    {
        $booking->loadMissing('service');
        $context = [
            'category_id' => $booking->service?->category_id,
            'region'      => $booking->delivery_location_region,
        ];

        if ($code !== null && trim($code) !== '') {
            $campaign = Campaign::whereRaw('LOWER(code) = ?', [strtolower(trim($code))])->first();
            if (! $campaign || ! $this->isEligible($campaign, $buyer, $context)) {
                return null;
            }
            return $campaign;
        }

        // Auto-apply: the highest-value eligible checkout campaign for this user.
        $candidates = Campaign::where('status', 'LIVE')
            ->where('audience_type', 'CUSTOMER')
            ->whereNull('code')
            ->get()
            ->filter(fn (Campaign $c) => $c->hasPlacement('APP_CHECKOUT') && $this->isEligible($c, $buyer, $context));

        return $candidates
            ->sortByDesc(fn (Campaign $c) => $this->computeDiscount($c, $booking))
            ->first();
    }

    private function isEligible(Campaign $campaign, User $buyer, array $context): bool
    {
        if ($campaign->audience_type !== 'CUSTOMER') {
            return false;
        }
        if (! $campaign->hasPlacement('APP_CHECKOUT')) {
            return false;
        }
        if (! $campaign->isCurrentlyLive()) {
            return false;
        }
        if (! $this->audience->matches($campaign, $buyer, $context)) {
            return false;
        }
        return $this->underPerUserCap($campaign, $buyer->id);
    }

    private function underPerUserCap(Campaign $campaign, string $userId): bool
    {
        if ($campaign->max_uses_per_user === null) {
            return true;
        }
        $used = CampaignLedgerEntry::where('campaign_id', $campaign->id)
            ->where('user_id', $userId)
            ->count();
        return $used < $campaign->max_uses_per_user;
    }

    /**
     * The ZMW discount for this campaign against this booking's service amount.
     * PERCENT/AMOUNT reduce the service price (capped at it); FREE_SERVICE_FEE
     * waives the buyer protection fee.
     */
    public function computeDiscount(Campaign $campaign, Booking $booking): float
    {
        $serviceAmount = (float) ($booking->agreed_amount ?? $booking->amount ?? 0);
        $protectionFee = (float) ($booking->buyer_protection_fee ?? 0);

        return match ($campaign->offer_type) {
            'PERCENT_OFF'      => round(min($serviceAmount, $serviceAmount * (float) $campaign->offer_value / 100), 2),
            'AMOUNT_OFF'       => round(min($serviceAmount, (float) $campaign->offer_value), 2),
            'FREE_SERVICE_FEE' => round($protectionFee, 2),
            default            => 0.0,
        };
    }

    /**
     * Flip a campaign to BUDGET_EXHAUSTED once its cap is reached and signal the
     * apps + admin so it stops rendering/applying immediately.
     */
    private function markExhaustedIfNeeded(string $campaignId): void
    {
        $campaign = Campaign::find($campaignId);
        if (! $campaign || $campaign->budget_cap === null) {
            return;
        }
        if ($campaign->budget_spent >= $campaign->budget_cap && $campaign->status === 'LIVE') {
            $campaign->update(['status' => 'BUDGET_EXHAUSTED']);
            PlacementChanged::fire($campaign->id, 'BUDGET_EXHAUSTED');
            \App\Events\AdminQueueEvent::fire('promotions', 'campaign.updated', $campaign->id, [
                'status' => 'BUDGET_EXHAUSTED',
            ]);
        }
    }
}
