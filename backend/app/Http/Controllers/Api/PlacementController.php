<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Growth\PlacementService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * App-facing placement evaluation. The client asks "what campaign, if any,
 * applies to THIS slot for ME right now?" and renders the content or nothing.
 * Eligibility is always resolved server-side (never by the client).
 */
class PlacementController extends Controller
{
    public function __construct(private readonly PlacementService $placements) {}

    /**
     * GET /placements/home — home-banner campaigns for the current user, in the
     * shape the app's banner carousel renders. Returns [] when none match.
     */
    public function home(Request $request): JsonResponse
    {
        return ApiResponse::success(
            $this->placements->homeBanners($request->user()),
            'Home placements retrieved.',
        );
    }
}
