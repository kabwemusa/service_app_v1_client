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

        // Growth & Promotions (APP_SEARCH_BADGE): label eligible results for the
        // current user. This is a cosmetic badge only — it NEVER reorders results
        // (promoted placement is the separate, structural `placement` field).
        $this->attachPromoBadges($result['data'], auth('api')->user());

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

    /**
     * Attach a `promo` badge ({label, campaign_id}) to each eligible result row.
     * Resolves the candidate campaigns once for the page, then labels by category.
     * Never throws — a badge failure must not break search.
     *
     * @param  array<int,object>  $rows
     */
    private function attachPromoBadges(array $rows, ?\App\Models\User $user): void
    {
        try {
            $badges = app(\App\Services\Growth\PlacementService::class)->badgesForServices(
                array_map(
                    fn ($r) => ['id' => $r->id, 'category_id' => (int) ($r->cat_id ?? 0), 'region' => null],
                    $rows,
                ),
                $user,
            );
            foreach ($rows as $row) {
                $row->promo = $badges[(string) $row->id] ?? null;
            }
        } catch (\Throwable $e) {
            Log::warning('SearchController: promo badge resolution failed', ['error' => $e->getMessage()]);
        }
    }
}
