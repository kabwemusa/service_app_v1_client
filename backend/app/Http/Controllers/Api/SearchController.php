<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Search\SearchRequest;
use App\Http\Resources\SearchResultResource;
use App\Services\SearchService;
use App\Services\SearchSuggestService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class SearchController extends Controller
{
    public function __construct(
        private readonly SearchService        $search,
        private readonly SearchSuggestService $suggest,
    ) {}

    /**
     * GET /search
     *
     * Query params (v3.1 §4.6 — no customer-facing radius control):
     *   - query       (string, optional)  Keyword search
     *   - lat         (float, optional)   Resolved delivery location L — latitude
     *   - lng         (float, optional)   Resolved delivery location L — longitude
     *   - category_id (int, optional)     Filter by category
     *   - page        (int, optional)     Page number (default 1)
     *
     * Response extras:
     *   - resolved_category  Present when `query` matches a category name/slug/synonym.
     *     Client uses this to render the subcategory refine-chip row.
     */
    public function __invoke(SearchRequest $request): JsonResponse
    {
        $validated = $request->validated();
        // Public endpoint — attribute the impression when a token is present (§7).
        $validated['user_id'] = auth('api')->user()?->id;

        $result = $this->search->search($validated);

        $resources = SearchResultResource::collection(
            collect($result['data'])
        );

        // Resolve category from free-text query so the client can show the
        // subcategory refine-chip row when the query matches a parent category.
        $resolvedCategory = null;
        $query = trim($validated['query'] ?? '');
        if ($query !== '' && empty($validated['category_id'])) {
            $resolvedCategory = $this->suggest->resolveCategory($query);
        }

      
        return ApiResponse::success([
            'data'              => $resources,
            'current_page'      => $result['current_page'],
            'last_page'         => $result['last_page'],
            'per_page'          => $result['per_page'],
            'total'             => $result['total'],
            'resolved_category' => $resolvedCategory,
            'fallback'          => $result['fallback'] ?? false,
            // §7 — clients reference this id from result_clicked / booking_started
            'impression_id'     => $result['impression_id'] ?? null,
        ], 'Search results retrieved.');
    }
}
