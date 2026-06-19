<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ReviewModerationRequest;
use App\Models\Review;
use App\Services\AdminReviewModerationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin Reviews moderation module API
 * (consumed by admin/src/lib/api/reviews.ts).
 *
 * Flat JSON (no ApiResponse envelope): the list returns { data, meta }; detail/
 * actions return the review detail object.
 *
 * Capability gating is applied at the route level:
 *   read:reviews     — list (needs-review + all) + detail (any read role)
 *   reviews.moderate — remove / restore / remove-response / clear-flags
 */
class AdminReviewController extends Controller
{
    public function __construct(private readonly AdminReviewModerationService $service) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->service->list([
            'tab'       => $request->string('tab')->toString() ?: 'needs_review',
            'page'      => $request->integer('page', 1),
            'search'    => $request->string('search')->toString(),
            'rating'    => $request->string('rating')->toString(),
            'provider'  => $request->string('provider')->toString(),
            'flag_type' => $request->string('flag_type')->toString(),
            'date_from' => $request->string('date_from')->toString(),
            'date_to'   => $request->string('date_to')->toString(),
        ]));
    }

    public function show(Review $review): JsonResponse
    {
        return response()->json($this->service->detail($review));
    }

    public function remove(Review $review, ReviewModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->remove($review, $request->user(), $request->validated('reason')),
        );
    }

    public function restore(Review $review, ReviewModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->restore($review, $request->user(), $request->validated('reason')),
        );
    }

    public function removeResponse(Review $review, ReviewModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->removeResponse($review, $request->user(), $request->validated('reason')),
        );
    }

    public function clearFlags(Review $review, ReviewModerationRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->markNotViolation($review, $request->user(), $request->validated('reason')),
        );
    }
}
