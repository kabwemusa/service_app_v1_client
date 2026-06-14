<?php

namespace App\Services\Ranking;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * v3.2 §2 — rules-based personalization (no ML, consistent with v3 §20).
 *
 *  B_personal = +0.15 when the buyer has ≥1 COMPLETED booking with this
 *               provider (rebooking the trusted person is the dominant
 *               behavior in this market — make it one tap shorter than
 *               WhatsApp), plus
 *               +0.03 when the buyer booked this category in the last 90 days.
 *
 * Per-buyer sets cache for 24h (buyer:{id}:repeat_providers,
 * buyer:{id}:recent_categories) and invalidate on booking completion.
 * Fully explainable: the boost appears per-result in scoreBreakdown().
 */
class PersonalizationService
{
    /**
     * Both boosts for one buyer, resolved against the cached sets.
     */
    public function boostFor(?string $buyerId, string $providerId, int $categoryId): float
    {
        if ($buyerId === null) {
            return 0.0;
        }

        $boost = 0.0;

        if (in_array($providerId, $this->repeatProviders($buyerId), true)) {
            $boost += (float) config('ranking.personal_repeat_boost');
        }

        if (in_array($categoryId, $this->recentCategories($buyerId), true)) {
            $boost += (float) config('ranking.personal_category_boost');
        }

        return $boost;
    }

    /** @return string[] provider ids the buyer has COMPLETED bookings with */
    public function repeatProviders(string $buyerId): array
    {
        return Cache::remember(
            "buyer:{$buyerId}:repeat_providers",
            (int) config('ranking.personal_cache_ttl_seconds'),
            function () use ($buyerId) {
                try {
                    return array_column(DB::select("
                        SELECT DISTINCT provider_id
                        FROM   bookings
                        WHERE  buyer_id = ?
                          AND  status   = 'COMPLETED'
                    ", [$buyerId]), 'provider_id');
                } catch (\Throwable $e) {
                    Log::warning('PersonalizationService::repeatProviders failed', ['error' => $e->getMessage()]);
                    return [];
                }
            },
        );
    }

    /** @return int[] category ids the buyer booked in the last 90 days */
    public function recentCategories(string $buyerId): array
    {
        return Cache::remember(
            "buyer:{$buyerId}:recent_categories",
            (int) config('ranking.personal_cache_ttl_seconds'),
            function () use ($buyerId) {
                $days = (int) config('ranking.personal_recent_days');

                try {
                    return array_map('intval', array_column(DB::select("
                        SELECT DISTINCT s.category_id
                        FROM   bookings b
                        JOIN   services s ON s.id = b.service_id
                        WHERE  b.buyer_id = ?
                          AND  b.status IN ('FUNDS_HELD', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED')
                          AND  b.created_at >= NOW() - INTERVAL '{$days} days'
                    ", [$buyerId]), 'category_id'));
                } catch (\Throwable $e) {
                    Log::warning('PersonalizationService::recentCategories failed', ['error' => $e->getMessage()]);
                    return [];
                }
            },
        );
    }

    /** Called on booking completion so the next search reflects the new pair. */
    public function invalidate(string $buyerId): void
    {
        Cache::forget("buyer:{$buyerId}:repeat_providers");
        Cache::forget("buyer:{$buyerId}:recent_categories");
    }
}
