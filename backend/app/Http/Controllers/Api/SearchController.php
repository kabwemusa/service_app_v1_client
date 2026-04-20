<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Search\SearchRequest;
use App\Http\Resources\SearchResultResource;
use App\Services\SearchService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

class SearchController extends Controller
{
    public function __construct(private readonly SearchService $search) {}

    /**
     * GET /search
     *
     * Query params:
     *   - query       (string, optional)  Keyword search
     *   - lat         (float, required)   Buyer's latitude
     *   - lng         (float, required)   Buyer's longitude
     *   - radius_km   (int, optional)     Search radius (max from config)
     *   - category_id (int, optional)     Filter by category
     *   - page        (int, optional)     Page number (default 1)
     */
    public function __invoke(SearchRequest $request): JsonResponse
    {
        $result = $this->search->search($request->validated());

        $resources = SearchResultResource::collection(
            collect($result['data'])
        );

        return ApiResponse::success([
            'data'         => $resources,
            'current_page' => $result['current_page'],
            'last_page'    => $result['last_page'],
            'per_page'     => $result['per_page'],
            'total'        => $result['total'],
        ], 'Search results retrieved.');
    }
}
