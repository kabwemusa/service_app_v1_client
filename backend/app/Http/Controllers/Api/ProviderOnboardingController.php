<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ProviderOnboardingService;
use App\Services\ProviderProfileService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Progressive provider onboarding (onboarding flow spec). Thin controller —
 * each step delegates to ProviderOnboardingService, which persists immediately
 * so the flow is resumable from any drop-off point.
 */
class ProviderOnboardingController extends Controller
{
    public function __construct(
        private readonly ProviderOnboardingService $onboarding,
        private readonly ProviderProfileService    $profiles,
    ) {}

    /** GET /provider/onboarding — resume payload (state, step, collected, eligibility). */
    public function show(Request $request): JsonResponse
    {
        return ApiResponse::success($this->onboarding->state($request->user()), 'Onboarding state retrieved.');
    }

    /** POST /provider/onboarding/about — name, languages, area. */
    public function about(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name'        => ['sometimes', 'string', 'max:100'],
            'languages'   => ['sometimes', 'array'],
            'languages.*' => ['string', 'in:en,ny,bem,ton'],
            'latitude'    => ['sometimes', 'numeric', 'between:-90,90'],
            'longitude'   => ['sometimes', 'numeric', 'between:-180,180'],
            'area_label'  => ['sometimes', 'string', 'max:120'],
        ]);

        $this->onboarding->saveAbout($request->user(), $data);

        return ApiResponse::success($this->onboarding->state($request->user()), 'Saved.');
    }

    /** POST /provider/onboarding/avatar — PUBLIC profile photo (≠ KYC selfie). */
    public function avatar(Request $request): JsonResponse
    {
        $request->validate([
            'photo' => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
        ]);

        $this->profiles->uploadAvatar($request->user(), $request->file('photo'));

        return ApiResponse::success($this->onboarding->state($request->user()), 'Profile photo saved.', 201);
    }

    /** POST /provider/onboarding/offer — category (→ risk tier) + optional catalog service. */
    public function offer(Request $request): JsonResponse
    {
        $data = $request->validate([
            'category_id' => ['required', 'integer', 'exists:categories,id'],
            'service_id'  => ['sometimes', 'nullable', 'uuid', 'exists:services,id'],
        ]);

        $this->onboarding->saveOffer($request->user(), (int) $data['category_id'], $data['service_id'] ?? null);

        return ApiResponse::success($this->onboarding->state($request->user()), 'Saved.');
    }

    /** POST /provider/onboarding/identity — NRC front + selfie + MoMo (universal base / Tier 1). */
    public function identity(Request $request): JsonResponse
    {
        $data = $request->validate([
            'nrc_front'     => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:8192'],
            'selfie'        => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:8192'],
            'momo_number'   => ['required', 'string', 'max:20'],
            'momo_provider' => ['sometimes', 'string', 'in:MTN,AIRTEL,ZAMTEL'],
        ]);

        $this->onboarding->submitIdentity(
            $request->user(),
            $request->file('nrc_front'),
            $request->file('selfie'),
            $data['momo_number'],
            $data['momo_provider'] ?? 'MTN',
        );

        return ApiResponse::success($this->onboarding->state($request->user()), 'Identity submitted.');
    }

    /** POST /provider/onboarding/service — title, price, quick availability. */
    public function service(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title'              => ['required', 'string', 'max:120'],
            'description'        => ['sometimes', 'nullable', 'string', 'max:2000'],
            'pricing_model'      => ['sometimes', 'in:OUTCOME_FIXED,PROVIDER_SCOPE,HOURLY_CAPPED,QUOTE_DEPOSIT'],
            // OUTCOME_FIXED: the outcome price. HOURLY_CAPPED: the hourly rate
            // (a default 1-hr min / 4-hr cap is applied, flagged for review).
            'price'              => ['required_unless:pricing_model,PROVIDER_SCOPE,QUOTE_DEPOSIT', 'nullable', 'numeric', 'min:0.01', 'max:99999.99'],
            'availability'                 => ['sometimes', 'array'],
            'availability.*.day_of_week'   => ['required_with:availability', 'integer', 'between:0,6'],
            'availability.*.start_time'    => ['required_with:availability', 'string'],
            'availability.*.end_time'      => ['required_with:availability', 'string'],
        ]);

        $this->onboarding->saveService($request->user(), $data);

        return ApiResponse::success($this->onboarding->state($request->user()), 'Service saved.', 201);
    }

    /** POST /provider/onboarding/payout — MoMo payout number (defaults to identity number). */
    public function payout(Request $request): JsonResponse
    {
        $data = $request->validate([
            'momo_number'   => ['sometimes', 'string', 'max:20'],
            'momo_provider' => ['sometimes', 'string', 'in:MTN,AIRTEL,ZAMTEL'],
        ]);

        $this->onboarding->savePayout($request->user(), $data['momo_number'] ?? null, $data['momo_provider'] ?? null);

        return ApiResponse::success($this->onboarding->state($request->user()), 'Payout saved.');
    }

    /** POST /provider/onboarding/go-live — eligibility check → LIVE or SET_UP + tier ladder. */
    public function goLive(Request $request): JsonResponse
    {
        return ApiResponse::success($this->onboarding->goLive($request->user()), 'Go-live evaluated.');
    }
}
