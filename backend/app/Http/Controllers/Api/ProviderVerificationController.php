<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ProviderVerificationService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Provider tier-upgrade / clearance flow. Submissions enter the existing admin
 * Verification queue; the eligibility flip happens on admin approval, not here.
 */
class ProviderVerificationController extends Controller
{
    public function __construct(private readonly ProviderVerificationService $service) {}

    /** GET /provider/verification — the tier ladder + live states (mirrors server eligibility). */
    public function show(Request $request): JsonResponse
    {
        return ApiResponse::success($this->service->status($request->user()), 'Verification status retrieved.');
    }

    /** POST /provider/verification/police-clearance — Tier 3 submission. */
    public function policeClearance(Request $request): JsonResponse
    {
        $data = $request->validate([
            'document'    => ['required', 'file', 'mimes:jpeg,jpg,png,webp,pdf', 'max:8192'],
            'cert_number' => ['required', 'string', 'max:60'],
            'issued_on'   => ['required', 'date', 'before_or_equal:today'],
            'expires_on'  => ['sometimes', 'nullable', 'date', 'after:issued_on'],
        ]);

        $this->service->submitPoliceClearance(
            $request->user(),
            $request->file('document'),
            $data['cert_number'],
            $data['issued_on'],
            $data['expires_on'] ?? null,
        );

        return ApiResponse::success($this->service->status($request->user()), 'Police clearance submitted for review.');
    }

    /** POST /provider/verification/portfolio — Tier 2 submission (multi-image, §5.3 pipeline). */
    public function portfolio(Request $request): JsonResponse
    {
        $request->validate([
            'images'   => ['required', 'array', 'min:3', 'max:8'],
            'images.*' => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
        ]);

        $this->service->submitPortfolio($request->user(), $request->file('images'));

        return ApiResponse::success($this->service->status($request->user()), 'Portfolio submitted for review.');
    }
}
