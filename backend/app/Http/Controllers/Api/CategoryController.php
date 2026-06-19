<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\Api\ForbiddenException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Category\StoreCategoryRequest;
use App\Http\Requests\Category\UpdateCategoryRequest;
use App\Http\Resources\CategoryResource;
use App\Services\AuditedMutationService;
use App\Services\CategoryService;
use App\Support\AdminCapabilities;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CategoryController extends Controller
{
    public function __construct(
        private readonly CategoryService $service,
        private readonly AuditedMutationService $auditService,
    ) {}

    // ── Public ─────────────────────────────────────────────────────────────────

    /** GET /categories — public, active only, hierarchical. */
    public function index(): JsonResponse
    {
        return ApiResponse::success(
            CategoryResource::collection($this->service->listActive()),
            'Categories retrieved.',
        );
    }

    // ── Admin (requires auth:admin + admin.can:categories.manage) ──────────────

    /** GET /admin/categories — all categories including inactive, hierarchical. */
    public function indexAll(): JsonResponse
    {
        return ApiResponse::success(
            CategoryResource::collection($this->service->listAll()),
            'Categories retrieved.',
        );
    }

    /** POST /admin/categories */
    public function store(StoreCategoryRequest $request): JsonResponse
    {
        $data   = $request->validated();
        $reason = $this->extractReason($data, 'Created via admin panel.');

        $category = $this->auditService->perform(
            actor: $request->user(),
            action: 'category.create',
            targetType: 'category',
            targetId: null,   // resolved from the returned model by AuditedMutationService
            reason: $reason,
            metadata: ['after' => $data],
            mutation: fn () => $this->service->create($data),
        );

        return ApiResponse::success(new CategoryResource($category), 'Category created.', 201);
    }

    /** PUT /admin/categories/{category} */
    public function update(UpdateCategoryRequest $request, int $category): JsonResponse
    {
        $existing = $this->service->findOrFail($category);
        $data     = $request->validated();
        $reason   = $this->extractReason($data, 'Updated via admin panel.');

        // commission_band changes require categories.set_band capability.
        if (array_key_exists('commission_band', $data) &&
            $data['commission_band'] !== $existing->commission_band) {
            if (! AdminCapabilities::roleHas($request->user()->role, 'categories.set_band')) {
                throw new ForbiddenException(
                    'Changing the commission band requires the categories.set_band capability.'
                );
            }
        }

        $before = [
            'name'            => $existing->name,
            'is_active'       => $existing->is_active,
            'commission_band' => $existing->commission_band,
            'parent_id'       => $existing->parent_id,
        ];

        $updated = $this->auditService->perform(
            actor: $request->user(),
            action: 'category.update',
            targetType: 'category',
            targetId: (string) $category,
            reason: $reason,
            metadata: ['before' => $before, 'after' => $data],
            mutation: fn () => $this->service->update($category, $data),
        );

        return ApiResponse::success(new CategoryResource($updated), 'Category updated.');
    }

    /** DELETE /admin/categories/{category} */
    public function destroy(Request $request, int $category): JsonResponse
    {
        $existing = $this->service->findOrFail($category);
        $reason   = trim($request->input('reason', ''));
        if (strlen($reason) < 10) {
            $reason = 'Deleted via admin panel.';
        }

        $this->auditService->perform(
            actor: $request->user(),
            action: 'category.delete',
            targetType: 'category',
            targetId: (string) $category,
            reason: $reason,
            metadata: ['before' => ['name' => $existing->name, 'is_active' => $existing->is_active]],
            mutation: fn () => $this->service->delete($category),
        );

        return ApiResponse::success(null, 'Category deleted.');
    }

    /** PATCH /admin/categories/reorder — bulk display_order update within siblings. */
    public function reorder(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'items'           => ['required', 'array', 'min:1'],
            'items.*.id'      => ['required', 'integer', 'exists:categories,id'],
            'items.*.display_order' => ['required', 'integer', 'min:0'],
            'reason'          => ['sometimes', 'string', 'min:10', 'max:1000'],
        ]);

        $reason = $this->extractReason($validated, 'Reordered categories.');

        $this->auditService->perform(
            actor: $request->user(),
            action: 'category.reorder',
            targetType: 'category',
            targetId: 'bulk',
            reason: $reason,
            metadata: ['items' => $validated['items']],
            mutation: fn () => $this->service->reorder($validated['items']),
        );

        return ApiResponse::success(null, 'Categories reordered.');
    }

    /** Pull `reason` out of the data array (so it's not persisted as a model field). */
    private function extractReason(array &$data, string $default): string
    {
        $reason = trim($data['reason'] ?? '');
        unset($data['reason']);
        return strlen($reason) >= 10 ? $reason : $default;
    }
}
