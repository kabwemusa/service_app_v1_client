<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Services\AdminFinanceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin Finance & Commissions module API (consumed by admin/src/lib/api/finance.ts).
 *
 * Capability gating: read:commissions (view all tabs), write:commissions
 * (commission band edits), write:payouts (payout retry — step-up).
 */
class AdminFinanceController extends Controller
{
    public function __construct(private readonly AdminFinanceService $service) {}

    public function overview(Request $request): JsonResponse
    {
        return response()->json($this->service->overview([
            'period' => $request->string('period')->toString() ?: 'month',
            'from'   => $request->string('from')->toString(),
            'to'     => $request->string('to')->toString(),
        ]));
    }

    public function commissions(Request $request): JsonResponse
    {
        return response()->json($this->service->commissionsList([
            'page'        => $request->integer('page', 1),
            'category_id' => $request->integer('category_id') ?: null,
            'tier'        => $request->string('tier')->toString(),
            'status'      => $request->string('status')->toString(),
            'date_from'   => $request->string('date_from')->toString(),
            'date_to'     => $request->string('date_to')->toString(),
        ]));
    }

    public function commissionBands(): JsonResponse
    {
        return response()->json(['data' => $this->service->commissionBands()]);
    }

    public function updateCommissionBand(Category $category, Request $request): JsonResponse
    {
        $data = $request->validate([
            'rates'          => ['required', 'array'],
            'rates.1'        => ['required', 'numeric', 'min:0', 'max:1'],
            'rates.2'        => ['required', 'numeric', 'min:0', 'max:1'],
            'rates.3'        => ['required', 'numeric', 'min:0', 'max:1'],
            'rates.4'        => ['required', 'numeric', 'min:0', 'max:1'],
            'reason'         => ['required', 'string', 'min:10', 'max:2000'],
        ]);

        $rates = array_map(fn ($v) => (float) $v, $data['rates']);

        return response()->json(
            $this->service->updateCommissionBand($category, $request->user(), $rates, $data['reason']),
        );
    }

    public function escrow(Request $request): JsonResponse
    {
        return response()->json($this->service->escrowList([
            'page'      => $request->integer('page', 1),
            'type'      => $request->string('type')->toString(),
            'date_from' => $request->string('date_from')->toString(),
        ]));
    }

    public function payouts(Request $request): JsonResponse
    {
        return response()->json($this->service->payoutsList([
            'page'        => $request->integer('page', 1),
            'provider_id' => $request->string('provider_id')->toString(),
            'status'      => $request->string('status')->toString(),
            'date_from'   => $request->string('date_from')->toString(),
        ]));
    }

    public function retryPayout(string $bookingId, Request $request): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:10', 'max:2000']]);

        return response()->json(
            $this->service->retryPayout($bookingId, $request->user(), $data['reason']),
        );
    }
}
