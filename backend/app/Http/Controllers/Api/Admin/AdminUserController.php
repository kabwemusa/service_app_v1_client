<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\DenylistAddRequest;
use App\Http\Requests\Admin\TierAdjustRequest;
use App\Http\Requests\Admin\UserModerationRequest;
use App\Models\User;
use App\Services\AdminUserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin Users module API (consumed by admin/src/lib/api/users.ts).
 *
 * Responses are the raw shapes the panel's TS types expect (no ApiResponse
 * envelope): the list returns { data, meta }; detail/actions return the
 * UserDetail object directly.
 *
 * Capability gating is applied at the route level:
 *   read:users      — list + detail (masked PII)
 *   users.view_pii  — reveal raw contact / identity (itself logged)
 *   users.moderate  — warn / suspend / reinstate
 *   ban:users       — ban (step-up)
 *   users.adjust_tier — tier adjustment
 *   write:denylist  — denylist add (step-up)
 */
class AdminUserController extends Controller
{
    public function __construct(private readonly AdminUserService $service) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->service->list([
            'page'    => $request->integer('page', 1),
            'search'  => $request->string('search')->toString(),
            'role'    => $request->string('role')->toString(),
            'status'  => $request->string('status')->toString(),
            'tier'    => $request->string('tier')->toString(),
            'flagged' => $request->string('flagged')->toString(),
        ]));
    }

    public function show(User $user, Request $request): JsonResponse
    {
        return response()->json($this->service->detail($user, $request->user()));
    }

    public function revealPii(User $user, Request $request): JsonResponse
    {
        return response()->json($this->service->revealPii($user, $request->user()));
    }

    public function warn(User $user, UserModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->warn($user, $request->user(), $request->validated('reason')),
        );
    }

    public function suspend(User $user, UserModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->suspend(
                $user,
                $request->user(),
                $request->validated('reason'),
                $request->integer('duration_days') ?: null,
            ),
        );
    }

    public function ban(User $user, UserModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->ban($user, $request->user(), $request->validated('reason')),
        );
    }

    public function reinstate(User $user, UserModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->reinstate($user, $request->user(), $request->validated('reason')),
        );
    }

    public function adjustTier(User $user, TierAdjustRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->adjustTier(
                $user,
                $request->user(),
                (int) $request->validated('tier'),
                $request->validated('reason'),
            ),
        );
    }

    public function addToDenylist(User $user, DenylistAddRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->addToDenylist(
                $user,
                $request->user(),
                $request->validated('identifiers'),
                $request->validated('category'),
                $request->validated('reason'),
            ),
        );
    }
}
