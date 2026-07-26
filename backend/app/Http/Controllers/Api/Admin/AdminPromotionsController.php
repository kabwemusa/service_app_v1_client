<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\AdminPromotionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Admin Growth & Promotions module API (consumed by admin/src/lib/api/promotions.ts).
 *
 * Capability gating: read:promotions (view), write:promotions (mutations). Every
 * mutation flows through AdminPromotionService → AuditedMutationService.
 */
class AdminPromotionsController extends Controller
{
    public function __construct(private readonly AdminPromotionService $service) {}

    // ── Reads (read:promotions) ──────────────────────────────────────────────

    public function overview(): JsonResponse
    {
        return response()->json($this->service->overview());
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->service->campaignsList([
            'page'          => $request->integer('page', 1),
            'status'        => $request->string('status')->toString(),
            'audience_type' => $request->string('audience_type')->toString(),
            'kind'          => $request->string('kind')->toString(),
            'search'        => $request->string('search')->toString(),
        ]));
    }

    public function show(string $id): JsonResponse
    {
        return response()->json($this->service->show($id));
    }

    public function audienceEstimate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'audience_type'   => ['required', Rule::in(config('growth.audience_types'))],
            'audience_filter' => ['required', 'string'],
            'audience_params' => ['sometimes', 'array'],
        ]);
        return response()->json($this->service->audienceEstimate($data));
    }

    public function performance(string $id): JsonResponse
    {
        return response()->json($this->service->performance($id));
    }

    public function referralConfig(): JsonResponse
    {
        return response()->json($this->service->referralConfig());
    }

    // ── Mutations (write:promotions) ─────────────────────────────────────────

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateCampaign($request);
        return response()->json(
            $this->service->create($request->user(), $data, $data['reason'], (bool) ($data['launch'] ?? false)),
            201,
        );
    }

    public function update(string $id, Request $request): JsonResponse
    {
        $data = $this->validateCampaign($request, updating: true);
        return response()->json($this->service->update($id, $request->user(), $data, $data['reason']));
    }

    public function launch(string $id, Request $request): JsonResponse
    {
        return response()->json($this->service->transition($id, $request->user(), 'LIVE', $this->reason($request)));
    }

    public function pause(string $id, Request $request): JsonResponse
    {
        return response()->json($this->service->transition($id, $request->user(), 'PAUSED', $this->reason($request)));
    }

    public function end(string $id, Request $request): JsonResponse
    {
        return response()->json($this->service->transition($id, $request->user(), 'ENDED', $this->reason($request)));
    }

    public function updateReferralConfig(Request $request): JsonResponse
    {
        $data = $request->validate([
            'enabled'                => ['required', 'boolean'],
            'referrer_reward_zmw'    => ['required', 'numeric', 'min:0'],
            'referee_reward_zmw'     => ['required', 'numeric', 'min:0'],
            'max_referrals_per_user' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'budget_cap'             => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'reason'                 => ['required', 'string', 'min:10', 'max:2000'],
        ]);
        return response()->json($this->service->updateReferralConfig($request->user(), $data, $data['reason']));
    }

    // ── Validation ───────────────────────────────────────────────────────────

    private function validateCampaign(Request $request, bool $updating = false): array
    {
        $sometimes = $updating ? 'sometimes' : 'required';

        return $request->validate([
            'name'            => [$sometimes, 'string', 'max:120'],
            'audience_type'   => [$sometimes, Rule::in(config('growth.audience_types'))],
            'audience_filter' => [$sometimes, 'string', 'max:40'],
            'audience_params' => ['sometimes', 'nullable', 'array'],
            'offer_type'      => [$sometimes, 'string', 'max:40'],
            'offer_value'     => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'offer_params'    => ['sometimes', 'nullable', 'array'],
            'placements'      => ['sometimes', 'array'],
            'placements.*'    => ['string', 'max:40'],
            'content'         => ['sometimes', 'nullable', 'array'],
            'code'            => ['sometimes', 'nullable', 'string', 'max:40', Rule::unique('campaigns', 'code')->ignore($request->route('id'))],
            'code_multi_use'  => ['sometimes', 'boolean'],
            'start_at'        => ['sometimes', 'nullable', 'date'],
            'end_at'          => ['sometimes', 'nullable', 'date', 'after_or_equal:start_at'],
            'budget_cap'      => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'max_uses_per_user' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'total_uses_cap'  => ['sometimes', 'nullable', 'integer', 'min:1'],
            'launch'          => ['sometimes', 'boolean'],
            'reason'          => ['required', 'string', 'min:10', 'max:2000'],
        ]);
    }

    private function reason(Request $request): string
    {
        return $request->validate(['reason' => ['required', 'string', 'min:10', 'max:2000']])['reason'];
    }
}
