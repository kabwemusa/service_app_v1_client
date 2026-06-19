<?php

namespace App\Http\Controllers\Api\Admin;

use App\Exceptions\Api\ApiException;
use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Services\AdminSafetyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin Safety module API (consumed by admin/src/lib/api/safety.ts).
 *
 * Highest-sensitivity surface — route-gated on `safety.handle` (trust_safety +
 * super_admin only). Reads are themselves logged inside the service. Responses
 * are the raw shapes the panel's TS types expect (no ApiResponse envelope).
 *
 * `{kind}` is `report` (safety_reports) or `emergency` (emergency_events).
 */
class AdminSafetyController extends Controller
{
    public function __construct(private readonly AdminSafetyService $service) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->service->queue([
            'page'     => $request->integer('page', 1),
            'severity' => $request->string('severity')->toString(),
            'status'   => $request->string('status')->toString(),
            'type'     => $request->string('type')->toString(),
        ]));
    }

    public function show(string $kind, string $id, Request $request): JsonResponse
    {
        $this->assertKind($kind);
        return response()->json($this->service->detail($kind, $id, $request->user()));
    }

    public function revealPii(string $kind, string $id, Request $request): JsonResponse
    {
        $this->assertKind($kind);
        return response()->json($this->service->revealPii($kind, $id, $request->user()));
    }

    public function claim(string $kind, string $id, Request $request): JsonResponse
    {
        $this->assertKind($kind);
        $reason = $this->reason($request);
        return response()->json($this->service->claim($kind, $id, $request->user(), $reason));
    }

    public function note(string $kind, string $id, Request $request): JsonResponse
    {
        $this->assertKind($kind);
        $data = $request->validate([
            'body' => ['required', 'string', 'min:10', 'max:2000'],
        ]);
        return response()->json($this->service->addNote($kind, $id, $request->user(), $data['body']));
    }

    public function restrictContact(string $kind, string $id, Request $request): JsonResponse
    {
        $this->assertKind($kind);
        $reason = $this->reason($request);
        return response()->json($this->service->restrictContact($kind, $id, $request->user(), $reason));
    }

    public function escalateAuthority(string $kind, string $id, Request $request): JsonResponse
    {
        $this->assertKind($kind);
        $reason = $this->reason($request);
        return response()->json($this->service->escalateAuthority($kind, $id, $request->user(), $reason));
    }

    public function escalateSuperAdmin(string $kind, string $id, Request $request): JsonResponse
    {
        $this->assertKind($kind);
        $reason = $this->reason($request);
        return response()->json($this->service->escalateSuperAdmin($kind, $id, $request->user(), $reason));
    }

    public function resolve(string $kind, string $id, Request $request): JsonResponse
    {
        $this->assertKind($kind);
        $data = $request->validate([
            'outcome' => ['required', 'string', 'in:ACTION_TAKEN,NO_ACTION,REFERRED,DUPLICATE'],
            'reason'  => ['required', 'string', 'min:10', 'max:2000'],
        ]);
        return response()->json($this->service->resolve($kind, $id, $request->user(), $data['outcome'], $data['reason']));
    }

    private function assertKind(string $kind): void
    {
        if (! in_array($kind, ['report', 'emergency'], true)) {
            throw new ApiException(ErrorCode::NOT_FOUND, 'Unknown safety record type.');
        }
    }

    /** Every mutating action requires a reason (AuditedMutationService re-enforces min length). */
    private function reason(Request $request): string
    {
        return $request->validate([
            'reason' => ['required', 'string', 'min:10', 'max:2000'],
        ])['reason'];
    }
}
