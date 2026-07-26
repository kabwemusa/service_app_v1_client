<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Legal\ConsentService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The consent MECHANISM endpoints (authenticated). Backs the accept/decline gate,
 * the re-consent prompt, in-app withdrawal, and data-subject-rights capture.
 *
 * The rendered legal text is served separately by LegalController (public) — this
 * controller only deals with the audit and the user's standing.
 */
class ConsentController extends Controller
{
    public function __construct(private readonly ConsentService $consent) {}

    /** GET /api/me/consent — does the user need to (re)consent, and current toggles. */
    public function status(Request $request): JsonResponse
    {
        return ApiResponse::success($this->consent->statusFor($request->user()));
    }

    /**
     * POST /api/me/consent — record acceptance of the required set + optional toggles.
     * Optional toggles are UNBUNDLED and default false: the client must send an
     * explicit boolean; nothing is pre-ticked or inferred.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'accept_required' => ['required', 'accepted'], // required agreements must be ticked
            'marketing'       => ['sometimes', 'boolean'],
            'analytics'       => ['sometimes', 'boolean'],
        ]);

        $record = $this->consent->grant(
            $request->user(),
            (bool) ($data['marketing'] ?? false),
            (bool) ($data['analytics'] ?? false),
            $this->meta($request),
        );

        return ApiResponse::success([
            'consent_id' => $record->id,
            'status'     => $this->consent->statusFor($request->user()),
        ], 'Consent recorded.', 201);
    }

    /** POST /api/me/consent/decline — the user declined at the gate. */
    public function decline(Request $request): JsonResponse
    {
        $this->consent->decline($request->user(), $this->meta($request));

        return ApiResponse::success(null, 'Recorded. You can return any time.');
    }

    /**
     * POST /api/me/consent/withdraw — withdraw a scope of consent.
     * scope: marketing | analytics | CORE. Withdrawing CORE means the service can
     * no longer be provided; the client surfaces that consequence before calling.
     */
    public function withdraw(Request $request): JsonResponse
    {
        $data = $request->validate([
            'scope' => ['required', 'in:marketing,analytics,CORE'],
        ]);

        $this->consent->withdraw($request->user(), $data['scope'], $this->meta($request));

        return ApiResponse::success([
            'status' => $this->consent->statusFor($request->user()),
        ], 'Consent withdrawn.');
    }

    /** GET /api/me/consent/history — the user's append-only consent trail. */
    public function history(Request $request): JsonResponse
    {
        $items = $this->consent->history($request->user())->map(fn ($r) => [
            'id'               => $r->id,
            'event'            => $r->event,
            'documents'        => $r->documents,
            'marketing_opt_in' => $r->marketing_opt_in,
            'analytics_opt_in' => $r->analytics_opt_in,
            'withdrawn_scope'  => $r->withdrawn_scope,
            'platform'         => $r->platform,
            'app_version'      => $r->app_version,
            'created_at'       => $r->created_at?->toIso8601String(),
        ]);

        return ApiResponse::success(['history' => $items]);
    }

    /**
     * POST /api/me/data-requests — capture a data-subject-rights request.
     * Fulfilment (export/erasure) is handled out of band; this records the request.
     */
    public function storeDataRequest(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type'    => ['required', 'in:ACCESS,RECTIFICATION,ERASURE,OBJECTION,RESTRICTION,PORTABILITY,WITHDRAW_CONSENT'],
            'details' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $req = $this->consent->openDataSubjectRequest(
            $request->user(),
            $data['type'],
            $data['details'] ?? null,
        );

        return ApiResponse::success([
            'request_id' => $req->id,
            'type'       => $req->type,
            'status'     => $req->status,
        ], 'Your request has been received. We will follow up on the contact details on your account.', 201);
    }

    /** GET /api/me/data-requests — the user's own submitted requests. */
    public function dataRequests(Request $request): JsonResponse
    {
        $items = $request->user()->dataSubjectRequests()
            ->orderByDesc('created_at')
            ->get()
            ->map(fn ($r) => [
                'id'         => $r->id,
                'type'       => $r->type,
                'status'     => $r->status,
                'details'    => $r->details,
                'created_at' => $r->created_at?->toIso8601String(),
                'resolved_at'=> $r->resolved_at?->toIso8601String(),
            ]);

        return ApiResponse::success(['requests' => $items]);
    }

    /** Provenance captured on every consent event for the audit trail. */
    private function meta(Request $request): array
    {
        return [
            'platform'    => $request->header('X-Client-Platform') ?? $request->input('platform'),
            'app_version' => $request->header('X-Client-Version')  ?? $request->input('app_version'),
            'ip_address'  => $request->ip(),
            'user_agent'  => (string) $request->userAgent(),
        ];
    }
}
