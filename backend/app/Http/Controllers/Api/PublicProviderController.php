<?php

namespace App\Http\Controllers\Api;

use App\Enums\TrustTier;
use App\Exceptions\Api\ForbiddenException;
use App\Exceptions\Api\NotFoundException;
use App\Http\Controllers\Controller;

use App\Models\User;
use App\Services\ProviderProfileService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class PublicProviderController extends Controller
{
    public function __construct(private readonly ProviderProfileService $profiles) {}

    /**
     * GET /providers/{userId}
     *
     * Public-safe profile for any sellable (Tier ≥ 1, ACTIVE) provider — the
     * same population the search index serves, so a card tapped in search can
     * never 403 here. Returns everything a customer needs to judge a provider:
     * identity (tier, badges), track record (rating, jobs, completion),
     * portfolio images, provider-curated highlights, services, and reviews.
     *
     * Never returns coordinates (v3.1 §4 — labels only) or reviewers' full
     * legal names.
     */
    public function show(string $userId): JsonResponse
    {
        $user = User::with('providerProfile')->find($userId);

        if (! $user || $user->role !== 'PROVIDER') {
            throw new NotFoundException('Provider');
        }

        $profile = $user->providerProfile;

        if (! $profile
            || ($profile->trust_tier ?? 0) < TrustTier::BASIC->value
            || $user->account_state !== 'ACTIVE') {
            throw new ForbiddenException('This provider is not yet verified.');
        }

        $highlights = array_merge(
            ['pinned_service_ids' => [], 'featured_photo_keys' => [], 'featured_badges' => []],
            (array) ($profile->highlights ?? []),
        );

        // A provider can only show badges they have actually earned.
        $earnedBadges   = $this->profiles->earnedBadges($user, $profile);
        $featuredBadges = array_values(array_intersect((array) $highlights['featured_badges'], $earnedBadges));

        // Active services — labels only, no coordinates (v3.1 §4)
        $services = DB::select("
            SELECT
                s.id,
                s.title,
                s.description,
                s.pricing_model,
                s.base_price,
                s.category_id,
                cat.name AS category_name
            FROM services s
            JOIN categories cat ON cat.id = s.category_id
            WHERE s.provider_id = ?
              AND s.status       = 'ACTIVE'
              AND cat.is_active  = true
            ORDER BY s.created_at DESC
        ", [$userId]);

        // Provider-pinned services first (highlights), then newest-first.
        $pinned = array_flip(array_values((array) $highlights['pinned_service_ids']));
        usort($services, function ($a, $b) use ($pinned) {
            $pa = $pinned[$a->id] ?? PHP_INT_MAX;
            $pb = $pinned[$b->id] ?? PHP_INT_MAX;
            return $pa <=> $pb;
        });

        // Recent reviews for this provider (latest 20)
        $reviews = DB::select("
            SELECT
                r.id,
                r.rating,
                r.comment,
                r.created_at,
                u.id   AS reviewer_id,
                u.legal_name AS reviewer_name
            FROM reviews r
            JOIN users u ON u.id = r.reviewer_id
            WHERE r.reviewee_id = ?
            ORDER BY r.created_at DESC
            LIMIT 20
        ", [$userId]);

        $jobsDone = (int) DB::table('bookings')
            ->where('provider_id', $userId)
            ->where('status', 'COMPLETED')
            ->count();

        return ApiResponse::success([
            'id'                  => $user->id,
            'display_name'        => $profile->display_name,
            'bio'                 => $profile->bio,
            // Public profile photo (v3.1 schema note) — distinct from the KYC selfie.
            'avatar_url'          => $profile->avatar_url,
            'cover_image_url'     => $profile->cover_image_url,
            'base_location_label' => $profile->base_location_label,
            'trust_tier'          => (int) ($profile->trust_tier ?? 0),
            'tier_label'          => $profile->tier()->label(),
            'year_started'        => $profile->year_started,
            'languages'           => (array) ($profile->languages ?? []),
            'r_raw'               => round((float) $user->r_raw, 2),
            'v_reviews'           => (int) $user->v_reviews,
            // NULL = no history yet (v3.2 §4.1) — clients render "–", never 0%
            'completion_rate'     => $user->completion_rate !== null ? round((float) $user->completion_rate, 2) : null,
            'last_active_at'      => $user->last_active_at?->toISOString(),
            'jobs_done'           => $jobsDone,
            'repeat_client_rate'  => $profile->repeat_client_rate,
            'response_time_p50_mins' => $profile->response_time_p50_mins,
            'earned_badges'       => $earnedBadges,
            'portfolio_images'    => array_values((array) ($profile->portfolio_images ?? [])),
            'highlights'          => [
                'pinned_service_ids'  => array_values((array) $highlights['pinned_service_ids']),
                'featured_photo_keys' => array_values((array) $highlights['featured_photo_keys']),
                'featured_badges'     => $featuredBadges,
            ],
            'profile'             => [
                'kyc_status'           => $profile->kyc_status,
                'max_radius_km'        => $profile->max_radius_km,
                'availability_matrix'  => $profile->availability_matrix,
                'profile_completeness' => $profile->profile_completeness,
            ],
            'services' => array_map(fn ($s) => [
                'id'            => $s->id,
                'title'         => $s->title,
                'description'   => $s->description,
                'pricing_model' => $s->pricing_model,
                'base_price'    => $s->base_price !== null ? (float) $s->base_price : null,
                'category'      => ['id' => $s->category_id, 'name' => $s->category_name],
                'is_pinned'     => isset($pinned[$s->id]),
            ], $services),
            'reviews' => array_map(fn ($rev) => [
                'id'         => $rev->id,
                'rating'     => (float) $rev->rating,
                'comment'    => $rev->comment,
                'created_at' => $rev->created_at,
                'reviewer'   => ['id' => $rev->reviewer_id, 'name' => $this->maskName($rev->reviewer_name)],
            ], $reviews),
        ], 'Provider profile retrieved.');
    }

    /** "Chanda Mwansa" → "Chanda M." — never expose a reviewer's full legal name. */
    private function maskName(?string $name): string
    {
        $parts = preg_split('/\s+/', trim((string) $name)) ?: [];
        $parts = array_values(array_filter($parts));

        if (count($parts) === 0) return 'Customer';
        if (count($parts) === 1) return $parts[0];

        return $parts[0] . ' ' . mb_substr(end($parts), 0, 1) . '.';
    }
}
