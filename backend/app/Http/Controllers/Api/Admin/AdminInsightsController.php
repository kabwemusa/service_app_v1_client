<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\AdminInsightsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin Dispatch & Trust Insights module API (consumed by
 * admin/src/lib/api/insights.ts). Capability gating: read:insights.
 * Read-only — no mutating endpoints.
 */
class AdminInsightsController extends Controller
{
    public function __construct(private readonly AdminInsightsService $service) {}

    public function dispatch(): JsonResponse
    {
        return response()->json($this->service->dispatch());
    }

    public function trust(): JsonResponse
    {
        return response()->json($this->service->trust());
    }

    public function supply(): JsonResponse
    {
        return response()->json($this->service->supply());
    }

    public function rankingCategories(): JsonResponse
    {
        return response()->json(['data' => $this->service->rankingCategories()]);
    }

    public function ranking(Request $request): JsonResponse
    {
        $data = $request->validate(['category_id' => ['required', 'integer']]);
        return response()->json($this->service->ranking((int) $data['category_id']));
    }
}
