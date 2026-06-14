<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\VerificationDecisionRequest;
use App\Models\IdentityDocument;
use App\Services\AdminVerificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Admin Verification queue API (consumed by admin/src/lib/api/verification.ts).
 *
 * Responses are the raw shapes the panel's TS types expect (no ApiResponse
 * envelope): the list returns { data, meta }; detail/decisions return the
 * VerificationDetail object directly.
 *
 * Capability gating is applied at the route level:
 *   read:verification  for GET, write:verification for decisions.
 */
class AdminVerificationController extends Controller
{
    public function __construct(private readonly AdminVerificationService $service) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->service->list([
            'page'   => $request->integer('page', 1),
            'type'   => $request->string('type')->toString(),
            'status' => $request->string('status')->toString(),
            'sla'    => $request->string('sla')->toString(),
            'search' => $request->string('search')->toString(),
            'sort'   => $request->string('sort', 'oldest')->toString(),
        ]));
    }

    public function show(IdentityDocument $document): JsonResponse
    {
        return response()->json($this->service->detail($document));
    }

    public function claim(IdentityDocument $document, Request $request): JsonResponse
    {
        return response()->json($this->service->claim($document, $request->user()));
    }

    public function release(IdentityDocument $document, Request $request): JsonResponse
    {
        return response()->json($this->service->release($document, $request->user()));
    }

    public function approve(IdentityDocument $document, VerificationDecisionRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->approve($document, $request->user(), $request->validated('reason')),
        );
    }

    public function reject(IdentityDocument $document, VerificationDecisionRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->reject($document, $request->user(), $request->validated('reason')),
        );
    }

    public function requestInfo(IdentityDocument $document, VerificationDecisionRequest $request): JsonResponse
    {
        return response()->json(
            $this->service->requestInfo($document, $request->user(), $request->validated('reason')),
        );
    }

    /**
     * Stream a KYC artifact (ID image / selfie). Authorized by a short-lived
     * signed URL (the `signed` middleware) rather than a bearer token, so the
     * panel's <img> tags can load it. The signed URL is only ever issued by the
     * capability-protected detail endpoint. Never cached, never public.
     */
    public function artifact(IdentityDocument $document, string $kind): StreamedResponse
    {
        $path = $this->service->artifactPath($document, $kind);

        abort_unless($path && Storage::disk('local')->exists($path), 404);

        return Storage::disk('local')->response($path, null, [
            'Cache-Control' => 'private, no-store, max-age=0',
        ]);
    }
}
