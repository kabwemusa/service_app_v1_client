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
}
