<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\ProviderProfile\KycUploadRequest;
use App\Http\Requests\ProviderProfile\UpsertProfileRequest;
use App\Http\Resources\ProviderProfileResource;
use App\Services\ProviderProfileService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProviderProfileController extends Controller
{
    public function __construct(private readonly ProviderProfileService $service) {}

    public function show(Request $request): JsonResponse
    {
        $profile = $this->service->getOrCreate($request->user());
        return \App\Support\ApiResponse::success(new ProviderProfileResource($profile), 'Profile retrieved.');
    }

    public function upsert(UpsertProfileRequest $request): JsonResponse
    {
        $profile = $this->service->upsert($request->user(), $request->validated());
        return \App\Support\ApiResponse::success(new ProviderProfileResource($profile), 'Profile updated.');
    }

    public function uploadKyc(KycUploadRequest $request): JsonResponse
    {
        $profile = $this->service->uploadKyc($request->user(), $request->file('student_id'));
        return \App\Support\ApiResponse::success(new ProviderProfileResource($profile), 'KYC document uploaded.');
    }

    /**
     * GET /provider/dashboard — §6.5 Hub aggregate (tier, checklist,
     * earnings vs cap, next-payout countdown, instant-payout eligibility).
     */
    public function dashboard(Request $request): JsonResponse
    {
        return \App\Support\ApiResponse::success($this->service->dashboard($request->user()), 'Dashboard retrieved.');
    }

    /**
     * GET /provider/earnings — §6.5/§9.3 Earnings tab aggregate (weekly/monthly/
     * lifetime totals, payout countdown, instant-payout eligibility, recent commissions).
     */
    public function earnings(Request $request): JsonResponse
    {
        return \App\Support\ApiResponse::success($this->service->earnings($request->user()), 'Earnings retrieved.');
    }

    /**
     * PATCH /provider/profile/availability-status — Hub Available/Away toggle.
     * Away stops NEW booking requests; confirmed bookings are unaffected.
     */
    public function updateAvailabilityStatus(Request $request): JsonResponse
    {
        $request->validate(['accepting_bookings' => ['required', 'boolean']]);

        $profile = $this->service->setAcceptingBookings($request->user(), $request->boolean('accepting_bookings'));

        return \App\Support\ApiResponse::success(
            ['accepting_bookings' => (bool) $profile->accepting_bookings],
            'Availability status updated.',
        );
    }

    /** POST /provider/profile/cover-photo — upload or replace the provider's profile photo. */
    public function uploadCoverPhoto(Request $request): JsonResponse
    {
        $request->validate([
            'photo' => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
        ]);

        $profile = $this->service->uploadCoverPhoto($request->user(), $request->file('photo'));
        return \App\Support\ApiResponse::success(new ProviderProfileResource($profile), 'Profile photo updated.', 201);
    }

    /** POST /provider/profile/portfolio — §6.6 portfolio manager (max 12 images / 5MB). */
    public function uploadPortfolioImage(Request $request): JsonResponse
    {
        $request->validate([
            'photo' => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
        ]);

        $profile = $this->service->addPortfolioImage($request->user(), $request->file('photo'));
        return \App\Support\ApiResponse::success(new ProviderProfileResource($profile), 'Portfolio image added.', 201);
    }

    /** DELETE /provider/profile/portfolio — remove a portfolio image by storage path. */
    public function deletePortfolioImage(Request $request): JsonResponse
    {
        $request->validate(['path' => ['required', 'string']]);

        $profile = $this->service->removePortfolioImage($request->user(), $request->string('path')->toString());
        return \App\Support\ApiResponse::success(new ProviderProfileResource($profile), 'Portfolio image removed.');
    }
}
