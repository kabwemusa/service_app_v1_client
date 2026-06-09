<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\Api\ForbiddenException;
use App\Exceptions\Api\NotFoundException;
use App\Http\Controllers\Controller;

use App\Models\User;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class PublicProviderController extends Controller
{
    /**
     * GET /providers/{userId}
     *
     * Returns public-safe profile data for a VERIFIED provider:
     *   - ranking metrics (r_raw, v_reviews, completion_rate)
     *   - kyc_status, max_radius_km, availability_matrix, profile_completeness
     *   - their active service listings (with PostGIS coords)
     */
    public function show(string $userId): JsonResponse
    {
        $user = User::with('providerProfile')->find($userId);

        if (! $user || $user->role !== 'PROVIDER') {
            throw new NotFoundException('Provider');
        }

        $profile = $user->providerProfile;

        if (! $profile || $profile->kyc_status !== 'VERIFIED') {
            throw new ForbiddenException('This provider is not yet verified.');
        }

        // Active services with coordinates
        $services = DB::select("
            SELECT
                s.id,
                s.title,
                s.description,
                s.pricing_model,
                s.base_price,
                s.category_id,
                cat.name AS category_name,
                ST_Y(s.service_location::geometry) AS latitude,
                ST_X(s.service_location::geometry) AS longitude
            FROM services s
            JOIN categories cat ON cat.id = s.category_id
            WHERE s.provider_id = ?
              AND s.status       = 'ACTIVE'
              AND cat.is_active  = true
            ORDER BY s.created_at DESC
        ", [$userId]);

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

        return ApiResponse::success([
            'id'                  => $user->id,
            'display_name'        => $profile->display_name,
            'bio'                 => $profile->bio,
            // Public profile photo (v3.1 schema note) — distinct from the KYC selfie.
            'avatar_url'          => $profile->avatar_url,
            'cover_image_url'     => $profile->cover_image_url,
            'base_location_label' => $profile->base_location_label,
            'r_raw'               => round((float) $user->r_raw, 2),
            'v_reviews'           => (int) $user->v_reviews,
            'completion_rate'     => round((float) $user->completion_rate, 2),
            'last_active_at'      => $user->last_active_at?->toISOString(),
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
                'latitude'      => $s->latitude  !== null ? (float) $s->latitude  : null,
                'longitude'     => $s->longitude !== null ? (float) $s->longitude : null,
            ], $services),
            'reviews' => array_map(fn ($rev) => [
                'id'         => $rev->id,
                'rating'     => (float) $rev->rating,
                'comment'    => $rev->comment,
                'created_at' => $rev->created_at,
                'reviewer'   => ['id' => $rev->reviewer_id, 'name' => $rev->reviewer_name],
            ], $reviews),
        ], 'Provider profile retrieved.');
    }
}
