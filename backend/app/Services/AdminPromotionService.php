<?php

namespace App\Services;

use App\Events\AdminQueueEvent;
use App\Events\PlacementChanged;
use App\Models\AdminUser;
use App\Models\Campaign;
use App\Models\CampaignLedgerEntry;
use App\Models\ReferralConfig;
use App\Services\Growth\AudienceResolver;

/**
 * Admin Growth & Promotions module (consumed by admin/src/lib/api/promotions.ts).
 *
 * Capability gating: read:promotions (view), write:promotions (create/launch/
 * pause/end + promo codes + referral config). Every state change runs through
 * AuditedMutationService and broadcasts so the app + admin update in real time.
 */
class AdminPromotionService
{
    public function __construct(
        private readonly AuditedMutationService $audit,
        private readonly AudienceResolver $audience,
    ) {}

    // ── Reads ────────────────────────────────────────────────────────────────

    public function overview(): array
    {
        $windowDays = (int) config('growth.kpi_window_days', 30);
        $since      = now()->subDays($windowDays);

        $activeStatuses = ['LIVE', 'SCHEDULED'];

        return [
            'kpis' => [
                'active_campaigns'    => (int) Campaign::whereIn('status', $activeStatuses)->count(),
                'redemptions_window'  => (int) CampaignLedgerEntry::where('created_at', '>=', $since)->count(),
                'discount_spend'      => round((float) CampaignLedgerEntry::where('created_at', '>=', $since)->sum('amount_zmw'), 2),
                'bookings_driven'     => (int) CampaignLedgerEntry::where('created_at', '>=', $since)
                    ->whereNotNull('booking_id')->distinct('booking_id')->count('booking_id'),
                'window_days'         => $windowDays,
            ],
        ];
    }

    public function campaignsList(array $filters): array
    {
        $q = Campaign::query()->latest('created_at');

        if (! empty($filters['status'])) {
            $q->where('status', $filters['status']);
        }
        if (! empty($filters['audience_type'])) {
            $q->where('audience_type', $filters['audience_type']);
        }
        if (! empty($filters['kind'])) {
            // 'code' → promo-code campaigns; 'campaign' → the rest.
            $filters['kind'] === 'code' ? $q->whereNotNull('code') : $q->whereNull('code');
        }
        if (! empty($filters['search'])) {
            $q->where('name', 'ilike', '%' . $filters['search'] . '%');
        }

        $paginator = $q->paginate(20, ['*'], 'page', $filters['page'] ?? 1);

        return [
            'data' => array_map(fn (Campaign $c) => $this->toRow($c), $paginator->items()),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page'    => $paginator->lastPage(),
                'per_page'     => $paginator->perPage(),
                'total'        => $paginator->total(),
            ],
        ];
    }

    public function show(string $id): array
    {
        $campaign = Campaign::findOrFail($id);
        return ['data' => $this->toDetail($campaign)];
    }

    /** Estimated audience size for the composer — resolved from live data. */
    public function audienceEstimate(array $data): array
    {
        $transient = new Campaign([
            'audience_type'   => $data['audience_type'] ?? 'CUSTOMER',
            'audience_filter' => $data['audience_filter'] ?? 'ALL_CUSTOMERS',
            'audience_params' => $data['audience_params'] ?? [],
        ]);
        return ['estimated_size' => $this->audience->estimateSize($transient)];
    }

    public function performance(string $id): array
    {
        $campaign = Campaign::findOrFail($id);

        $redemptions = (int) CampaignLedgerEntry::where('campaign_id', $id)->count();
        $spend       = round((float) CampaignLedgerEntry::where('campaign_id', $id)->sum('amount_zmw'), 2);
        $bookings    = (int) CampaignLedgerEntry::where('campaign_id', $id)
            ->whereNotNull('booking_id')->distinct('booking_id')->count('booking_id');

        $daily = CampaignLedgerEntry::where('campaign_id', $id)
            ->selectRaw('DATE(created_at) as day, COUNT(*) as redemptions, SUM(amount_zmw) as spend')
            ->groupByRaw('DATE(created_at)')
            ->orderByRaw('DATE(created_at)')
            ->get()
            ->map(fn ($r) => [
                'day'         => (string) $r->day,
                'redemptions' => (int) $r->redemptions,
                'spend'       => round((float) $r->spend, 2),
            ])->all();

        return [
            'data' => [
                'campaign'    => $this->toRow($campaign),
                'redemptions' => $redemptions,
                'spend'       => $spend,
                'bookings_driven' => $bookings,
                // Honest attribution: we do not run a holdout, so incremental lift
                // is not measured. Report only what a redemption directly caused.
                'incremental_measured' => false,
                'daily'       => $daily,
            ],
        ];
    }

    public function referralConfig(): array
    {
        return ['data' => $this->referralPayload(ReferralConfig::current())];
    }

    // ── Mutations (audited) ──────────────────────────────────────────────────

    public function create(AdminUser $actor, array $data, string $reason, bool $launch): array
    {
        $status = $this->initialStatus($data, $launch);

        $campaign = $this->audit->perform(
            actor: $actor,
            action: 'promotion.create',
            targetType: 'campaign',
            targetId: null,
            reason: $reason,
            metadata: ['after' => ['name' => $data['name'] ?? null, 'status' => $status]],
            mutation: function () use ($data, $status, $actor) {
                return Campaign::create(array_merge(
                    $this->fillableFrom($data),
                    ['status' => $status, 'created_by_admin_id' => $actor->id],
                ));
            },
        );

        if (in_array($status, ['LIVE', 'BUDGET_EXHAUSTED'], true)) {
            PlacementChanged::fire($campaign->id, 'LAUNCHED');
        }
        AdminQueueEvent::fire('promotions', 'campaign.updated', $campaign->id, ['status' => $status]);

        return ['data' => $this->toDetail($campaign->fresh())];
    }

    public function update(string $id, AdminUser $actor, array $data, string $reason): array
    {
        $campaign = Campaign::findOrFail($id);
        $before   = $campaign->only(['name', 'offer_type', 'offer_value', 'placements', 'status']);

        $this->audit->perform(
            actor: $actor,
            action: 'promotion.update',
            targetType: 'campaign',
            targetId: $campaign->id,
            reason: $reason,
            metadata: ['before' => $before, 'after' => ['name' => $data['name'] ?? $campaign->name]],
            mutation: fn () => $campaign->update($this->fillableFrom($data)),
        );

        PlacementChanged::fire($campaign->id, 'UPDATED');
        AdminQueueEvent::fire('promotions', 'campaign.updated', $campaign->id, []);

        return ['data' => $this->toDetail($campaign->fresh())];
    }

    public function transition(string $id, AdminUser $actor, string $to, string $reason): array
    {
        $campaign = Campaign::findOrFail($id);
        $from     = $campaign->status;

        $this->assertTransition($from, $to);

        $this->audit->perform(
            actor: $actor,
            action: 'promotion.' . strtolower($to),
            targetType: 'campaign',
            targetId: $campaign->id,
            reason: $reason,
            metadata: ['before' => ['status' => $from], 'after' => ['status' => $to]],
            mutation: fn () => $campaign->update(['status' => $to]),
        );

        PlacementChanged::fire($campaign->id, $to);
        AdminQueueEvent::fire('promotions', 'campaign.updated', $campaign->id, ['status' => $to]);

        return ['data' => $this->toDetail($campaign->fresh())];
    }

    public function updateReferralConfig(AdminUser $actor, array $data, string $reason): array
    {
        $config = ReferralConfig::current();
        $before = $config->only(['enabled', 'referrer_reward_zmw', 'referee_reward_zmw', 'budget_cap']);

        $this->audit->perform(
            actor: $actor,
            action: 'promotion.referral_config_update',
            targetType: 'referral_config',
            targetId: (string) $config->id,
            reason: $reason,
            metadata: ['before' => $before, 'after' => $data],
            mutation: fn () => $config->update([
                'enabled'                => (bool) ($data['enabled'] ?? false),
                'referrer_reward_zmw'    => (float) ($data['referrer_reward_zmw'] ?? 0),
                'referee_reward_zmw'     => (float) ($data['referee_reward_zmw'] ?? 0),
                'max_referrals_per_user' => $data['max_referrals_per_user'] ?? null,
                'budget_cap'             => $data['budget_cap'] ?? null,
            ]),
        );

        return ['data' => $this->referralPayload($config->fresh())];
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function initialStatus(array $data, bool $launch): string
    {
        if (! $launch) {
            return 'DRAFT';
        }
        $startAt = ! empty($data['start_at']) ? \Carbon\Carbon::parse($data['start_at']) : null;
        return ($startAt && $startAt->isFuture()) ? 'SCHEDULED' : 'LIVE';
    }

    private function assertTransition(string $from, string $to): void
    {
        $allowed = match ($to) {
            'LIVE'   => ['DRAFT', 'SCHEDULED', 'PAUSED'],
            'PAUSED' => ['LIVE'],
            'ENDED'  => ['DRAFT', 'SCHEDULED', 'LIVE', 'PAUSED', 'BUDGET_EXHAUSTED'],
            default  => [],
        };
        if (! in_array($from, $allowed, true)) {
            throw new \App\Exceptions\Api\ApiException(
                \App\Enums\ErrorCode::VALIDATION_ERROR,
                "A {$from} campaign can't move to {$to}.",
            );
        }
    }

    private function fillableFrom(array $data): array
    {
        return collect($data)->only([
            'name', 'audience_type', 'audience_filter', 'audience_params',
            'offer_type', 'offer_value', 'offer_params', 'placements', 'content',
            'code', 'code_multi_use', 'start_at', 'end_at', 'budget_cap',
            'max_uses_per_user', 'total_uses_cap',
        ])->toArray();
    }

    private function metrics(Campaign $campaign): array
    {
        $redemptions = (int) CampaignLedgerEntry::where('campaign_id', $campaign->id)->count();
        $bookings    = (int) CampaignLedgerEntry::where('campaign_id', $campaign->id)
            ->whereNotNull('booking_id')->distinct('booking_id')->count('booking_id');

        return [
            'redemptions'     => $redemptions,
            'spend'           => round((float) $campaign->budget_spent, 2),
            'budget_cap'      => $campaign->budget_cap !== null ? round((float) $campaign->budget_cap, 2) : null,
            'bookings_driven' => $bookings,
        ];
    }

    private function toRow(Campaign $campaign): array
    {
        return [
            'id'            => $campaign->id,
            'name'          => $campaign->name,
            'audience_type' => $campaign->audience_type,
            'audience_filter' => $campaign->audience_filter,
            'offer_type'    => $campaign->offer_type,
            'offer_value'   => (float) $campaign->offer_value,
            'placements'    => $campaign->placements ?? [],
            'code'          => $campaign->code,
            'status'        => $campaign->status,
            'start_at'      => $campaign->start_at?->toIso8601String(),
            'end_at'        => $campaign->end_at?->toIso8601String(),
            'metrics'       => $this->metrics($campaign),
        ];
    }

    private function toDetail(Campaign $campaign): array
    {
        return array_merge($this->toRow($campaign), [
            'audience_params'   => $campaign->audience_params ?? [],
            'offer_params'      => $campaign->offer_params ?? [],
            'content'           => $campaign->content ?? [],
            'code_multi_use'    => (bool) $campaign->code_multi_use,
            'max_uses_per_user' => $campaign->max_uses_per_user,
            'total_uses_cap'    => $campaign->total_uses_cap,
            'total_uses'        => $campaign->total_uses,
            'created_at'        => $campaign->created_at?->toIso8601String(),
        ]);
    }

    private function referralPayload(ReferralConfig $config): array
    {
        return [
            'enabled'                => $config->enabled,
            'referrer_reward_zmw'    => (float) $config->referrer_reward_zmw,
            'referee_reward_zmw'     => (float) $config->referee_reward_zmw,
            'max_referrals_per_user' => $config->max_referrals_per_user,
            'budget_cap'             => $config->budget_cap !== null ? (float) $config->budget_cap : null,
            'budget_spent'           => (float) $config->budget_spent,
            // Flagged in the UI: config is editable, but the live mechanic isn't built.
            'implemented'            => false,
        ];
    }
}
