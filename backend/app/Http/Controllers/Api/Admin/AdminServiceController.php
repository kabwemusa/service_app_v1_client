<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ServiceModerationRequest;
use App\Http\Requests\Admin\ServiceReassignCategoryRequest;
use App\Models\Service;
use App\Models\ServicePhoto;
use App\Services\AdminServiceModerationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin Services moderation module API
 * (consumed by admin/src/lib/api/services.ts).
 *
 * Flat JSON (no ApiResponse envelope) to match the panel's TS types: the list
 * returns { data, meta }; detail/actions return the service detail object.
 *
 * Capability gating is applied at the route level:
 *   read:services     — list (needs-review + all) + detail (any read role)
 *   services.moderate — hide / require-changes / restore / reassign / remove-photo
 */
class AdminServiceController extends Controller
{
    public function __construct(private readonly AdminServiceModerationService $service) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->service->list([
            'tab'         => $request->string('tab')->toString() ?: 'needs_review',
            'page'        => $request->integer('page', 1),
            'search'      => $request->string('search')->toString(),
            'status'      => $request->string('status')->toString(),
            'category_id' => $request->string('category_id')->toString(),
            'provider'    => $request->string('provider')->toString(),
            'price_min'   => $request->string('price_min')->toString(),
            'price_max'   => $request->string('price_max')->toString(),
        ]));
    }

    public function show(Service $service): JsonResponse
    {
        return response()->json($this->service->detail($service));
    }

    public function hide(Service $service, ServiceModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->hide($service, $request->user(), $request->validated('reason')),
        );
    }

    public function requireChanges(Service $service, ServiceModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->requireChanges($service, $request->user(), $request->validated('reason')),
        );
    }

    public function restore(Service $service, ServiceModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->restore($service, $request->user(), $request->validated('reason')),
        );
    }

    public function reassignCategory(Service $service, ServiceReassignCategoryRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->reassignCategory(
                $service,
                $request->user(),
                (int) $request->validated('category_id'),
                $request->validated('reason'),
            ),
        );
    }

    public function removePhoto(Service $service, ServicePhoto $photo, ServiceModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->removePhoto($service, $photo, $request->user(), $request->validated('reason')),
        );
    }
}
