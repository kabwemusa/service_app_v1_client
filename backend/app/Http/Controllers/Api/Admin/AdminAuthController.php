<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\AdminLoginRequest;
use App\Models\AdminUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;

/**
 * Admin-panel authentication. Returns FLAT JSON (no ApiResponse envelope) to
 * match the shapes the panel's TypeScript expects (LoginResponse / AdminTokenPayload).
 */
class AdminAuthController extends Controller
{
    /**
     * POST /api/admin/auth/login
     * Body: { email (email OR username), password }
     */
    public function login(AdminLoginRequest $request): JsonResponse
    {
        $identifier = trim($request->validated('email'));
        $password   = $request->validated('password');

        $admin = AdminUser::query()
            ->where('username', $identifier)
            ->orWhere('email', strtolower($identifier))
            ->first();

        if (! $admin || ! Hash::check($password, $admin->password)) {
            // Generic message — never reveal which factor failed.
            return response()->json(['message' => 'Invalid email or password.'], 401);
        }

        $token = auth('admin')->login($admin);

        $admin->forceFill(['last_login_at' => now()])->save();

        // MFA is reserved but not enforced in the pilot. When enabled, return
        // { mfa_required: true, mfa_partial_token: ... } here instead.
        return response()->json(['token' => $token]);
    }

    /**
     * GET /api/admin/auth/me — current admin profile (requires auth:admin).
     */
    public function me(): JsonResponse
    {
        /** @var AdminUser $admin */
        $admin = auth('admin')->user();

        return response()->json([
            'id'           => $admin->id,
            'email'        => $admin->email,
            'name'         => $admin->name,
            'role'         => $admin->role,
            'capabilities' => $admin->capabilities(),
            'avatar_url'   => $admin->avatar_url,
        ]);
    }

    /**
     * POST /api/admin/auth/logout — invalidate the current token.
     */
    public function logout(): JsonResponse
    {
        auth('admin')->logout();

        return response()->json(['message' => 'Logged out.']);
    }
}
