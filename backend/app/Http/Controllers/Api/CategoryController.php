<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Category\StoreCategoryRequest;
use App\Http\Requests\Category\UpdateCategoryRequest;
use App\Http\Resources\CategoryResource;
use App\Services\CategoryService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

class CategoryController extends Controller
{
    public function __construct(private readonly CategoryService $service) {}

    /** GET /categories — public, active only */
    public function index(): JsonResponse
    {
        return ApiResponse::success(
            CategoryResource::collection($this->service->listActive()),
            'Categories retrieved.',
        );
    }

    /** GET /admin/categories — admin, all */
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
        $category = $this->service->create($request->validated());
        return ApiResponse::success(new CategoryResource($category), 'Category created.', 201);
    }

    /** PUT /admin/categories/{category} */
    public function update(UpdateCategoryRequest $request, int $category): JsonResponse
    {
        $updated = $this->service->update($category, $request->validated());
        return ApiResponse::success(new CategoryResource($updated), 'Category updated.');
    }

    /** DELETE /admin/categories/{category} */
    public function destroy(int $category): JsonResponse
    {
        $this->service->delete($category);
        return ApiResponse::success(null, 'Category deleted.');
    }
}
