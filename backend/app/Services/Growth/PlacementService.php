<?php

namespace App\Services\Growth;

use App\Models\Campaign;
use App\Models\CampaignLedgerEntry;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Evaluates campaigns against a user for the non-checkout app slots:
 *   • APP_HOME_BANNER — dismissible promo banners (merged into the existing
 *     home-banner carousel).
 *   • APP_SEARCH_BADGE — a "20% off" style badge on eligible search results.
 *
 * The client NEVER decides eligibility. Everything here is resolved server-side
 * against LIVE campaign state, schedule, budget remaining, the user's audience
 * membership, and the per-user usage cap. Returns content or nothing.
 */
class PlacementService
{
    public function __construct(private readonly AudienceResolver $audience) {}

    /**
     * Home-banner campaigns for this user, in the HomeBanner shape the app's
     * carousel already renders. Anonymous users get audience-agnostic campaigns
     * (ALL_CUSTOMERS) only.
     *
     * @return array<int,array<string,mixed>>
     */
    public function homeBanners(?User $user): array
    {
        return $this->liveForSlot('APP_HOME_BANNER', 'CUSTOMER')
            ->filter(fn (Campaign $c) => $this->eligibleForDisplay($c, $user))
            ->map(fn (Campaign $c) => $this->toBannerPayload($c))
            ->values()
            ->all();
    }

    /**
     * Resolve a search badge for one service result, or null. Applied only to
     * services the campaign actually covers (by category / area) — badging never
     * reorders results; it only labels them.
     *
     * @param  array{category_id?:int,region?:?string}  $service
     * @return array{label:string,campaign_id:string}|null
     */
    public function badgeForService(array $service, ?User $user): ?array
    {
        $context = [
            'category_id' => $service['category_id'] ?? null,
            'region'      => $service['region'] ?? null,
        ];

        foreach ($this->liveForSlot('APP_SEARCH_BADGE', 'CUSTOMER') as $campaign) {
            if (! $this->coversService($campaign, $service)) {
                continue;
            }
            if (! $this->eligibleForDisplay($campaign, $user, $context)) {
                continue;
            }
            return [
                'label'       => $this->badgeLabel($campaign),
                'campaign_id' => $campaign->id,
            ];
        }
        return null;
    }

    /**
     * Batch variant for a page of search results — resolves the candidate
     * campaigns once, then labels each service. Keyed by service id.
     *
     * @param  array<int,array{id:mixed,category_id?:int,region?:?string}>  $services
     * @return array<string,array{label:string,campaign_id:string}>
     */
    public function badgesForServices(array $services, ?User $user): array
    {
        $campaigns = $this->liveForSlot('APP_SEARCH_BADGE', 'CUSTOMER')
            ->filter(fn (Campaign $c) => $this->eligibleForDisplay($c, $user));

        if ($campaigns->isEmpty()) {
            return [];
        }

        $out = [];
        foreach ($services as $service) {
            foreach ($campaigns as $campaign) {
                if ($this->coversService($campaign, $service)) {
                    $out[(string) $service['id']] = [
                        'label'       => $this->badgeLabel($campaign),
                        'campaign_id' => $campaign->id,
                    ];
                    break;
                }
            }
        }
        return $out;
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /** LIVE, in-schedule, budget-remaining campaigns for a slot + audience type. */
    private function liveForSlot(string $slot, string $audienceType): Collection
    {
        return Campaign::where('status', 'LIVE')
            ->where('audience_type', $audienceType)
            ->get()
            ->filter(fn (Campaign $c) => $c->hasPlacement($slot) && $c->isCurrentlyLive());
    }

    /** Audience membership + per-user cap (banner/badge visibility). */
    private function eligibleForDisplay(Campaign $campaign, ?User $user, array $context = []): bool
    {
        if ($user === null) {
            // Anonymous: only audience-agnostic campaigns are shown.
            return $campaign->audience_filter === 'ALL_CUSTOMERS';
        }
        if (! $this->audience->matches($campaign, $user, $context)) {
            return false;
        }
        return $this->underPerUserCap($campaign, $user->id);
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

    /** Does the campaign's targeting actually cover this service (category/area)? */
    private function coversService(Campaign $campaign, array $service): bool
    {
        if ($campaign->audience_filter === 'BY_CATEGORY') {
            $ids = array_map('intval', $campaign->audience_params['category_ids'] ?? []);
            return isset($service['category_id']) && in_array((int) $service['category_id'], $ids, true);
        }
        if ($campaign->audience_filter === 'BY_AREA') {
            $regions = array_map('strval', $campaign->audience_params['area_regions'] ?? []);
            return isset($service['region']) && $service['region'] !== null
                && in_array((string) $service['region'], $regions, true);
        }
        // Non-geo/category audiences (ALL / NEW / LAPSED) badge every service.
        return true;
    }

    private function toBannerPayload(Campaign $campaign): array
    {
        $content = $campaign->content ?? [];
        return [
            'id'         => $campaign->id,
            'type'       => 'PROMO',
            'title'      => $content['title'] ?? $campaign->name,
            'subtitle'   => $content['subtitle'] ?? null,
            'image_url'  => $content['image_url'] ?? null,
            'bg_token'   => $content['bg_token'] ?? 'primary',
            'cta_label'  => $content['cta_label'] ?? null,
            'cta_action' => $content['cta_action'] ?? null,
            'campaign_id' => $campaign->id,
        ];
    }

    private function badgeLabel(Campaign $campaign): string
    {
        $content = $campaign->content ?? [];
        if (! empty($content['badge_label'])) {
            return $content['badge_label'];
        }
        // Format with decimals first so the point guards the integer part —
        // rtrim only trims the fractional zeros (20.00 → 20, 20.50 → 20.5).
        $num = rtrim(rtrim(number_format((float) $campaign->offer_value, 2, '.', ''), '0'), '.');

        return match ($campaign->offer_type) {
            'PERCENT_OFF'      => $num . '% off',
            'AMOUNT_OFF'       => 'ZMW ' . $num . ' off',
            'FREE_SERVICE_FEE' => 'No service fee',
            default            => 'Offer',
        };
    }
}
