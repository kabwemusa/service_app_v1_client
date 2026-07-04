<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\FraudDenylist;
use App\Services\AdminFraudService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin Fraud & Denylist module API (consumed by admin/src/lib/api/fraud.ts).
 *
 * Capability gating: read:fraud (view), write:fraud (pattern workflow),
 * write:denylist (add/lift — step-up).
 */
class AdminFraudController extends Controller
{
    public function __construct(private readonly AdminFraudService $service) {}

    public function patterns(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->service->patterns([
            'status'      => $request->string('status')->toString(),
            'signal_type' => $request->string('signal_type')->toString(),
        ])]);
    }

    public function claimSignal(Request $request): JsonResponse
    {
        $data = $this->signalRequest($request);
        return response()->json($this->service->claimSignal($data['signal'], $request->user(), $data['reason']));
    }

    public function markFalsePositive(Request $request): JsonResponse
    {
        $data = $this->signalRequest($request);
        return response()->json($this->service->markFalsePositive($data['signal'], $request->user(), $data['reason']));
    }

    public function escalateSignal(Request $request): JsonResponse
    {
        $data = $this->signalRequest($request);
        return response()->json($this->service->escalateSignal($data['signal'], $request->user(), $data['reason']));
    }

    private function signalRequest(Request $request): array
    {
        return $request->validate([
            'signal'                 => ['required', 'array'],
            'signal.signal_key'      => ['required', 'string'],
            'signal.signal_type'     => ['required', 'string'],
            'signal.severity'        => ['required', 'string'],
            'signal.affected_users'  => ['required', 'array'],
            'signal.source_module'   => ['nullable', 'string'],
            'signal.source_id'       => ['nullable', 'string'],
            'signal.detected_at'     => ['required', 'string'],
            'reason'                 => ['required', 'string', 'min:10', 'max:2000'],
        ]);
    }

    public function denylist(Request $request): JsonResponse
    {
        return response()->json($this->service->denylist([
            'page'   => $request->integer('page', 1),
            'type'   => $request->string('type')->toString(),
            'status' => $request->string('status')->toString(),
            'search' => $request->string('search')->toString(),
        ]));
    }

    public function addToDenylist(Request $request): JsonResponse
    {
        $data = $request->validate([
            'hash_type'  => ['required', 'string', 'in:NRC_HASH,PASSPORT_HASH,PHONE_HASH,EMAIL_HASH,DEVICE_HASH,MOMO_NUMBER_HASH'],
            'identifier' => ['required', 'string'],
            'category'   => ['required', 'string', 'in:CONFIRMED_FRAUD,SERIAL_DISPUTE,IDENTITY_FRAUD,OFF_PLATFORM_ATTEMPT,CHARGEBACK_ABUSE,ADMIN_MANUAL'],
            'reason'     => ['required', 'string', 'min:10', 'max:2000'],
        ]);

        return response()->json(
            $this->service->addToDenylist($request->user(), $data['hash_type'], $data['identifier'], $data['category'], $data['reason']),
        );
    }

    public function liftFromDenylist(FraudDenylist $denylist, Request $request): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:10', 'max:2000']]);
        return response()->json($this->service->liftFromDenylist($denylist, $request->user(), $data['reason']));
    }

    public function exportDenylist(): JsonResponse
    {
        return response()->json(['data' => $this->service->exportDenylist()]);
    }

    public function escalations(): JsonResponse
    {
        return response()->json(['data' => $this->service->escalations()]);
    }
}
