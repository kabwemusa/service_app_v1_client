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
use Illuminate\Support\Facades\Storage;

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
     * POST /api/auth/otp/request — passwordless phone-OTP (canonical).
     * Find-or-creates the account for the number and SMSes a code.
     */
    public function requestOtp(Request $request): JsonResponse
    {
        $data = $request->validate([
            'phone'  => ['required', 'string', 'max:20'],
            'intent' => ['sometimes', 'in:CUSTOMER,PROVIDER'],
        ]);

        $result = $this->authService->requestPhoneOtp(
            $data['phone'],
            $data['intent'] ?? 'CUSTOMER',
        );

        return ApiResponse::success($result, 'A verification code has been sent by SMS.');
    }

    /**
     * POST /api/auth/otp/verify — verify a phone OTP, issue tokens, merge any
     * anonymous (guest) context onto the now-identified account.
     */
    public function verifyPhoneOtp(Request $request): JsonResponse
    {
        $data = $request->validate([
            'phone'       => ['required', 'string', 'max:20'],
            'otp'         => ['required', 'string', 'size:6'],
            'guest_token' => ['sometimes', 'nullable', 'string', 'max:128'],
        ]);

        $tokens = $this->authService->verifyPhoneOtp(
            $data['phone'],
            $data['otp'],
            $data['guest_token'] ?? null,
        );

        return ApiResponse::success(new AuthTokenResource($tokens), 'Phone verified successfully.');
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
     * PATCH /api/me/account — update phone / name for the authenticated user
     */
    public function updateAccount(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'phone' => [
                'sometimes', 'nullable', 'string', 'max:20',
                \Illuminate\Validation\Rule::unique('users', 'phone')->ignore($user->id),
            ],
            'name'  => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);

        if (array_key_exists('phone', $data)) {
            $user->phone = $data['phone'];
        }
        if (array_key_exists('name', $data)) {
            $user->legal_name = $data['name'];
        }

        $user->save();

        return ApiResponse::success($this->accountPayload($user), 'Account updated.');
    }

    /**
     * POST /api/me/avatar — customer profile photo. Public storage; never the
     * KYC selfie (same convention as the provider avatar).
     */
    public function uploadAvatar(Request $request): JsonResponse
    {
        $request->validate([
            'photo' => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
        ]);

        $user = $request->user();

        if (! empty($user->avatar_url)) {
            Storage::disk('public')->delete($user->avatar_url);
        }

        $user->avatar_url = $request->file('photo')->store('avatars', 'public');
        $user->save();

        return ApiResponse::success($this->accountPayload($user), 'Profile photo updated.', 201);
    }

    /** Shared account payload — keeps the client's cached user in sync after any edit. */
    private function accountPayload(User $user): array
    {
        return [
            'id'              => $user->id,
            'email'           => $user->email,
            'phone'           => $user->phone,
            'legal_name'      => $user->legal_name,
            'avatar_url'      => $user->avatar_url,
            'role'            => $user->role,
            'is_verified'     => $user->is_verified,
            'completion_rate' => $user->completion_rate,
            'r_raw'           => $user->r_raw,
            'v_reviews'       => $user->v_reviews,
        ];
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
