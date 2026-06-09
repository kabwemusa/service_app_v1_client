<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\HomeBannerResource;
use App\Models\HomeBanner;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

class HomeBannerController extends Controller
{
    /**
     * GET /home-banners
     *
     * Returns currently-active banners ordered by priority.
     * Capped at 6. Never throws — the Home screen must render even if
     * this call fails, so errors are silently handled client-side.
     */
    public function index(): JsonResponse
    {
        $banners = HomeBanner::where('is_active', true)
            ->where('start_at', '<=', now())
            ->where('end_at', '>=', now())
            ->orderByDesc('priority')
            ->limit(6)
            ->get();

        return ApiResponse::success(
            HomeBannerResource::collection($banners),
            'Home banners retrieved.'
        );
    }
}
