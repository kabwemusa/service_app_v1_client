<?php

namespace App\Services\Growth;

use App\Models\Campaign;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Resolves a campaign's audience from LIVE data — never a stored list.
 *
 * `matches()` answers "is THIS user in the audience right now?" (eligibility);
 * `estimateSize()` answers "how many users match?" for the composer. Both read
 * the same real signals: booking history, primary area/region, category history,
 * account age, provider activity.
 */
class AudienceResolver
{
    /**
     * Is $user a member of $campaign's audience right now?
     *
     * $context may carry booking-time facts the plain user record can't supply,
     * e.g. ['category_id' => 12, 'region' => 'Lusaka'] at checkout, so an
     * APP_CHECKOUT campaign can honour BY_CATEGORY / BY_AREA against the booking
     * rather than the customer's stored home area.
     */
    public function matches(Campaign $campaign, User $user, array $context = []): bool
    {
        // The audience_type must match the user's role intent.
        if ($campaign->audience_type === 'CUSTOMER' && $user->role === 'PROVIDER') {
            // A provider account acting as a customer is still eligible for
            // customer offers when booking — role alone doesn't disqualify.
        }

        return match ($campaign->audience_filter) {
            'ALL_CUSTOMERS'  => true,
            'NEW_CUSTOMERS'  => $this->completedBuyerBookings($user->id) === 0,
            'LAPSED'         => $this->isLapsed($user->id, $this->lapsedDays($campaign)),
            'BY_AREA'        => $this->matchesArea($campaign, $user, $context),
            'BY_CATEGORY'    => $this->matchesCategory($campaign, $user, $context),
            'NEW_PROVIDERS'  => $this->isNewProvider($user),
            'LOW_ACTIVITY'   => $this->isLowActivityProvider($user, $campaign),
            default          => false,
        };
    }

    /**
     * Estimated audience size for the composer. Approximate by design — the count
     * is a planning aid, and the exact set is re-resolved per user at eval time.
     */
    public function estimateSize(Campaign $campaign): int
    {
        return match ($campaign->audience_filter) {
            'ALL_CUSTOMERS'  => (int) User::where('role', 'CUSTOMER')->count(),
            'NEW_CUSTOMERS'  => $this->newCustomersCount(),
            'LAPSED'         => $this->lapsedCount($this->lapsedDays($campaign)),
            'BY_AREA'        => $this->byAreaCount($campaign),
            'BY_CATEGORY'    => $this->byCategoryCount($campaign),
            'NEW_PROVIDERS'  => (int) User::where('role', 'PROVIDER')
                ->where('created_at', '>=', now()->subDays((int) config('growth.new_provider_days')))
                ->count(),
            'LOW_ACTIVITY'   => $this->lowActivityCount($campaign),
            default          => 0,
        };
    }

    // ── Per-user predicates ──────────────────────────────────────────────────

    private function completedBuyerBookings(string $userId): int
    {
        return (int) DB::table('bookings')
            ->where('buyer_id', $userId)
            ->where('status', 'COMPLETED')
            ->count();
    }

    private function isLapsed(string $userId, int $days): bool
    {
        // Has at least one booking, but none within the lapsed window.
        $total = DB::table('bookings')->where('buyer_id', $userId)->count();
        if ($total === 0) {
            return false;
        }
        $recent = DB::table('bookings')
            ->where('buyer_id', $userId)
            ->where('created_at', '>=', now()->subDays($days))
            ->count();
        return $recent === 0;
    }

    private function matchesArea(Campaign $campaign, User $user, array $context): bool
    {
        $regions = array_map('strval', $campaign->audience_params['area_regions'] ?? []);
        if (empty($regions)) {
            return false;
        }
        $region = $context['region'] ?? $user->primary_location_region;
        return $region !== null && in_array((string) $region, $regions, true);
    }

    private function matchesCategory(Campaign $campaign, User $user, array $context): bool
    {
        $categoryIds = array_map('intval', $campaign->audience_params['category_ids'] ?? []);
        if (empty($categoryIds)) {
            return false;
        }

        // At checkout the booking's own category is authoritative.
        if (isset($context['category_id'])) {
            return in_array((int) $context['category_id'], $categoryIds, true);
        }

        // Otherwise: has the customer ever booked in one of these categories?
        return DB::table('bookings')
            ->join('services', 'services.id', '=', 'bookings.service_id')
            ->where('bookings.buyer_id', $user->id)
            ->whereIn('services.category_id', $categoryIds)
            ->exists();
    }

    private function isNewProvider(User $user): bool
    {
        return $user->role === 'PROVIDER'
            && $user->created_at !== null
            && $user->created_at->isAfter(now()->subDays((int) config('growth.new_provider_days')));
    }

    private function isLowActivityProvider(User $user, Campaign $campaign): bool
    {
        if ($user->role !== 'PROVIDER') {
            return false;
        }
        $days    = (int) config('growth.low_activity_days');
        $maxJobs = (int) ($campaign->audience_params['max_jobs'] ?? config('growth.low_activity_max_jobs'));

        $recent = DB::table('bookings')
            ->where('provider_id', $user->id)
            ->where('status', 'COMPLETED')
            ->where('completed_at', '>=', now()->subDays($days))
            ->count();

        return $recent <= $maxJobs;
    }

    // ── Aggregate counts (composer estimates) ────────────────────────────────

    private function newCustomersCount(): int
    {
        return (int) DB::table('users')
            ->where('role', 'CUSTOMER')
            ->whereNotExists(function ($q) {
                $q->select(DB::raw(1))->from('bookings')
                    ->whereColumn('bookings.buyer_id', 'users.id')
                    ->where('bookings.status', 'COMPLETED');
            })
            ->count();
    }

    private function lapsedCount(int $days): int
    {
        return (int) DB::table('users')
            ->where('role', 'CUSTOMER')
            ->whereExists(function ($q) {
                $q->select(DB::raw(1))->from('bookings')
                    ->whereColumn('bookings.buyer_id', 'users.id');
            })
            ->whereNotExists(function ($q) use ($days) {
                $q->select(DB::raw(1))->from('bookings')
                    ->whereColumn('bookings.buyer_id', 'users.id')
                    ->where('bookings.created_at', '>=', now()->subDays($days));
            })
            ->count();
    }

    private function byAreaCount(Campaign $campaign): int
    {
        $regions = array_map('strval', $campaign->audience_params['area_regions'] ?? []);
        if (empty($regions)) {
            return 0;
        }
        return (int) DB::table('users')
            ->where('role', 'CUSTOMER')
            ->whereIn('primary_location_region', $regions)
            ->count();
    }

    private function byCategoryCount(Campaign $campaign): int
    {
        $categoryIds = array_map('intval', $campaign->audience_params['category_ids'] ?? []);
        if (empty($categoryIds)) {
            return 0;
        }
        return (int) DB::table('bookings')
            ->join('services', 'services.id', '=', 'bookings.service_id')
            ->whereIn('services.category_id', $categoryIds)
            ->distinct('bookings.buyer_id')
            ->count('bookings.buyer_id');
    }

    private function lowActivityCount(Campaign $campaign): int
    {
        $days    = (int) config('growth.low_activity_days');
        $maxJobs = (int) ($campaign->audience_params['max_jobs'] ?? config('growth.low_activity_max_jobs'));

        return (int) DB::table('users')
            ->where('role', 'PROVIDER')
            ->where(function ($q) use ($days, $maxJobs) {
                $q->whereRaw(
                    '(SELECT COUNT(*) FROM bookings b WHERE b.provider_id = users.id '
                    . "AND b.status = 'COMPLETED' AND b.completed_at >= ?) <= ?",
                    [now()->subDays($days), $maxJobs],
                );
            })
            ->count();
    }

    private function lapsedDays(Campaign $campaign): int
    {
        return (int) ($campaign->audience_params['lapsed_days'] ?? config('growth.lapsed_days_default'));
    }
}
