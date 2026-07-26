<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\HomeBannerResource;
use App\Models\HomeBanner;
use App\Services\Growth\PlacementService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class HomeBannerController extends Controller
{
    public function __construct(private readonly PlacementService $placements) {}

    /**
     * GET /home-banners
     *
     * Returns currently-active banners ordered by priority, with any LIVE
     * Growth & Promotions campaign banners the current user is eligible for
     * (APP_HOME_BANNER) merged in ahead of the static ones. Capped at 6. Never
     * throws — the Home screen must render even if this call fails, so errors
     * are silently handled client-side.
     */
    public function index(): JsonResponse
    {
        $static = HomeBanner::where('is_active', true)
            ->where('start_at', '<=', now())
            ->where('end_at', '>=', now())
            ->orderByDesc('priority')
            ->limit(6)
            ->get()
            ->map(fn ($b) => (new HomeBannerResource($b))->toArray(request()))
            ->all();

        // Campaign banners resolved server-side for THIS user's audience.
        $campaign = [];
        try {
            $campaign = $this->placements->homeBanners(auth('api')->user());
        } catch (\Throwable $e) {
            Log::warning('HomeBannerController: campaign banner resolution failed', ['error' => $e->getMessage()]);
        }

        $merged = array_slice(array_merge($campaign, $static), 0, 6);

        return ApiResponse::success($merged, 'Home banners retrieved.');
    }
}
