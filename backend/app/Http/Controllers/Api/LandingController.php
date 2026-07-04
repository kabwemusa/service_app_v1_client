<?php

namespace App\Http\Controllers\Api;

use App\Enums\TrustTier;
use App\Http\Controllers\Controller;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Public marketing summary for the PWA landing page — real platform numbers
 * and real reviews (never fabricated testimonials). Unauthenticated, so it
 * exposes only aggregates plus the same masked review shape the public
 * provider profile already serves.
 */
class LandingController extends Controller
{
    private const CACHE_KEY = 'landing:summary';
    private const CACHE_TTL = 600; // seconds — marketing numbers can lag 10 min

    public function summary(): JsonResponse
    {
        $payload = Cache::remember(self::CACHE_KEY, self::CACHE_TTL, function () {
            // Sellable providers: the same gate search + public profiles apply.
            $providers = DB::table('users as u')
                ->join('provider_profiles as p', 'p.user_id', '=', 'u.id')
                ->where('u.role', 'PROVIDER')
                ->where('u.account_state', 'ACTIVE')
                ->where('p.trust_tier', '>=', TrustTier::BASIC->value)
                ->count();

            $jobsDone = DB::table('bookings')->where('status', 'COMPLETED')->count();

            $ratingRow = DB::table('reviews')
                ->whereNull('removed_at')
                ->selectRaw('COUNT(*) AS n, AVG(rating) AS avg')
                ->first();

            // Featured reviews: recent, positive, non-empty, not moderated away.
            // Reviews only exist for COMPLETED bookings (§10.4) — always verified.
            $reviews = DB::table('reviews as r')
                ->join('users as u', 'u.id', '=', 'r.reviewer_id')
                ->leftJoin('bookings as b', 'b.id', '=', 'r.booking_id')
                ->leftJoin('services as s', 's.id', '=', 'b.service_id')
                ->whereNull('r.removed_at')
                ->where('r.rating', '>=', 4)
                ->whereNotNull('r.comment')
                ->whereRaw("btrim(r.comment) <> ''")
                ->orderByDesc('r.created_at')
                ->limit(8)
                ->get([
                    'r.id',
                    'r.rating',
                    'r.comment',
                    'r.created_at',
                    'u.legal_name as reviewer_name',
                    's.title as service_title',
                ]);

            return [
                'stats' => [
                    'providers'  => $providers,
                    'jobs_done'  => $jobsDone,
                    'reviews'    => (int) ($ratingRow->n ?? 0),
                    'avg_rating' => $ratingRow && $ratingRow->n > 0 ? round((float) $ratingRow->avg, 1) : null,
                ],
                'reviews' => $reviews->map(fn ($r) => [
                    'id'         => $r->id,
                    'rating'     => (float) $r->rating,
                    'comment'    => $r->comment,
                    'created_at' => $r->created_at,
                    'reviewer'   => $this->maskName($r->reviewer_name),
                    'service'    => $r->service_title,
                ])->values()->all(),
            ];
        });

        return ApiResponse::success($payload, 'Landing summary retrieved.');
    }

    /** "Chanda Mwansa" → "Chanda M." — never expose a reviewer's full legal name. */
    private function maskName(?string $name): string
    {
        $parts = preg_split('/\s+/', trim((string) $name)) ?: [];
        $parts = array_values(array_filter($parts));

        if ($parts === []) {
            return 'A customer';
        }
        if (count($parts) === 1) {
            return $parts[0];
        }

        return $parts[0] . ' ' . mb_strtoupper(mb_substr((string) end($parts), 0, 1)) . '.';
    }
}
