<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\AdminSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin Platform Settings module API (consumed by admin/src/lib/api/settings.ts).
 * Capability gating: read:settings (view), write:settings (edit — super_admin only).
 */
class AdminSettingsController extends Controller
{
    public function __construct(private readonly AdminSettingsService $service) {}

    public function group(string $group): JsonResponse
    {
        return response()->json(['data' => $this->service->group($group)]);
    }

    public function update(string $key, Request $request): JsonResponse
    {
        $data = $request->validate([
            'value'  => ['required'],
            'reason' => ['required', 'string', 'min:10', 'max:2000'],
        ]);

        return response()->json(['data' => $this->service->update($key, $request->user(), $data['value'], $data['reason'])]);
    }

    public function riskTiers(): JsonResponse
    {
        return response()->json(['data' => $this->service->riskTiers()]);
    }

    public function updateRiskTier(int $riskTier, Request $request): JsonResponse
    {
        $data = $request->validate([
            'requirements' => ['required', 'array'],
            'reason'       => ['required', 'string', 'min:10', 'max:2000'],
        ]);

        return response()->json(['data' => $this->service->updateRiskTier($riskTier, $request->user(), $data['requirements'], $data['reason'])]);
    }

    public function denylistCheckConfig(): JsonResponse
    {
        return response()->json($this->service->denylistCheckConfig());
    }
}
