<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Requests\Auth\VerifyOtpRequest;
use App\Http\Resources\Auth\AuthTokenResource;
use App\Models\User;
use App\Services\AuthService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuthController extends Controller
{
    public function __construct(private readonly AuthService $authService) {}

    /**
     * POST /api/auth/register
     */
    public function register(RegisterRequest $request): JsonResponse
    {
        $user = $this->authService->register($request->validated());

        return ApiResponse::success(
            ['user_id' => $user->id],
            'Registration successful. Please check your email for the OTP.',
            201,
        );
    }

    /**
     * POST /api/auth/verify-otp
     */
    public function verifyOtp(VerifyOtpRequest $request): JsonResponse
    {
        $user   = User::findOrFail($request->validated('user_id'));
        $tokens = $this->authService->verifyOtp($user, $request->validated('otp'));

        return ApiResponse::success(
            new AuthTokenResource($tokens),
            'Email verified successfully.',
        );
    }

    /**
     * POST /api/auth/login
     */
    public function login(LoginRequest $request): JsonResponse
    {
        $tokens = $this->authService->login(
            $request->validated('identifier'),
            $request->validated('password'),
        );

        return ApiResponse::success(
            new AuthTokenResource($tokens),
            'Logged in successfully.',
        );
    }

    /**
     * POST /api/auth/refresh
     */
    public function refresh(Request $request): JsonResponse
    {
        $request->validate(['refresh_token' => ['required', 'string']]);

        $tokens = $this->authService->refreshTokens($request->validated('refresh_token'));

        return ApiResponse::success(
            new AuthTokenResource($tokens),
            'Token refreshed.',
        );
    }

    /**
     * POST /api/auth/logout  — requires auth:api
     */
    public function logout(Request $request): JsonResponse
    {
        $request->validate(['refresh_token' => ['sometimes', 'string']]);

        $this->authService->logout($request->input('refresh_token', ''));

        return ApiResponse::success(null, 'Logged out successfully.');
    }

    /**
     * POST /api/auth/resend-otp
     */
    public function resendOtp(Request $request): JsonResponse
    {
        $request->validate(['user_id' => ['required', 'uuid', 'exists:users,id']]);

        $user = User::findOrFail($request->validated('user_id'));

        if ($user->is_verified) {
            return ApiResponse::success(null, 'Account is already verified.');
        }

        $this->authService->resendOtp($user);

        return ApiResponse::success(null, 'A new OTP has been sent to your email.');
    }
}
