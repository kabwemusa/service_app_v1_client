<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Search\MatchRequest;
use App\Http\Resources\SearchResultResource;
use App\Services\Matching\MatchingService;
use App\Services\SearchService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * POST /match — the natural-language service matcher, the primary customer entry
 * point on the app home and (via ConversationEngine) WhatsApp. Same backend,
 * same thresholds, identical results across surfaces.
 *
 * Flow: matchServices(query) finds WHAT (real category / services); when it
 * matches we hand that to the ranking engine (SearchService) to decide WHO and
 * return ranked real services. Otherwise we return a clarify prompt (2–3 real
 * options) or an honest empty state — never a fabricated match.
 */
class MatchController extends Controller
{
    public function __construct(
        private readonly MatchingService $matcher,
        private readonly SearchService   $search,
    ) {}

    public function __invoke(MatchRequest $request): JsonResponse
    {
        $v      = $request->validated();
        $userId = auth('api')->user()?->id;

        $match = $this->matcher->match($v['query'], $userId, 'app');

        $payload = [
            'status'            => $match['status'],
            'layer'             => $match['layer'],
            'confidence'        => $match['confidence'],
            'used_llm'          => $match['used_llm'],
            'log_id'            => $match['log_id'],
            'query'             => $match['query'],
            'resolved_category' => null,
            'candidates'        => [],
            'closest_categories'=> [],
            'data'              => [],
            'total'             => 0,
            'fallback'          => false,
        ];

        // ── CLARIFY — ask with real options, never guess ─────────────────────
        if ($match['status'] === 'clarify') {
            $payload['candidates']         = $match['candidates'];
            $payload['closest_categories'] = $match['closest_categories'];
            return ApiResponse::success($payload, 'Did you mean one of these?');
        }

        // ── EMPTY — honest "we don't have that yet" + closest categories ─────
        if ($match['status'] === 'empty' || $match['resolved_category_id'] === null) {
            $payload['closest_categories'] = $match['closest_categories'];
            $payload['status']             = 'empty';
            return ApiResponse::success($payload, "We don't have that yet.");
        }

        // ── MATCHED — rank the matched set with the existing ranking engine ──
        $searchParams = [
            'category_id' => $match['resolved_category_id'],
            'user_id'     => $userId,
            'page'        => $v['page'] ?? 1,
        ];
        foreach (['lat', 'lng', 'region', 'region_city', 'region_ward'] as $k) {
            if (isset($v[$k]) && $v[$k] !== null) {
                $searchParams[$k] = $v[$k];
            }
        }

        $result = $this->search->search($searchParams);

        // When the matcher pinned specific real services (service-level match),
        // surface those first while keeping the rest of the ranked category set.
        $data = collect($result['data']);
        if (! empty($match['service_ids'])) {
            $ids  = array_flip($match['service_ids']);
            $data = $data->sortBy(fn ($row) => isset($ids[$row->id]) ? 0 : 1)->values();
        }

        $payload['data']              = SearchResultResource::collection($data);
        $payload['total']             = $result['total'];
        $payload['fallback']          = $result['fallback'] ?? false;
        $payload['resolved_category'] = ['id' => $match['resolved_category_id']];
        $payload['impression_id']     = $result['impression_id'] ?? null;

        // No local supply for a real match is still a match — flag, don't hide it.
        if ($result['total'] === 0) {
            $payload['status'] = 'matched_no_supply';
        }

        return ApiResponse::success($payload, 'Matched services retrieved.');
    }

    /**
     * POST /match/{log}/outcome — record what the customer did after a match
     * (booked | refined | abandoned). Feeds the tuning dataset for synonym /
     * threshold calibration. Query-text only; no PII.
     */
    public function outcome(string $log, \Illuminate\Http\Request $request): JsonResponse
    {
        $data = $request->validate([
            'outcome'           => ['required', 'string', 'in:booked,refined,abandoned'],
            'booked_service_id' => ['nullable', 'string', 'max:64'],
        ]);

        $this->matcher->recordOutcome($log, $data['outcome'], $data['booked_service_id'] ?? null);

        return ApiResponse::success(null, 'Outcome recorded.');
    }
}
