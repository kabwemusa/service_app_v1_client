<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\ServiceRequest\RespondServiceRequestRequest;
use App\Http\Requests\ServiceRequest\StoreServiceRequestRequest;
use App\Services\ServiceRequestService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * v3.2 §6 — post-a-request endpoints. Buyer side broadcasts and selects;
 * provider side feeds and responds. Downstream booking/escrow is the
 * unchanged standard flow.
 */
class ServiceRequestController extends Controller
{
    public function __construct(private readonly ServiceRequestService $requests) {}

    /** POST /service-requests — broadcast a request to the top-10 matched providers. */
    public function store(StoreServiceRequestRequest $request): JsonResponse
    {
        $created = $this->requests->create($request->user(), $request->validated());

        return ApiResponse::success([
            'id'             => $created->id,
            'status'         => $created->status,
            'notified_count' => $created->targets->count(),
        ], 'Request posted — nearby providers have been notified.', 201);
    }

    /** GET /service-requests — the buyer's recent requests. */
    public function index(Request $request): JsonResponse
    {
        return ApiResponse::success($this->requests->listForBuyer($request->user()), 'Requests retrieved.');
    }

    /** GET /service-requests/{id} — one request with its responses. */
    public function show(Request $request, string $id): JsonResponse
    {
        return ApiResponse::success($this->requests->showForBuyer($request->user(), $id), 'Request retrieved.');
    }

    /** POST /service-requests/{id}/cancel */
    public function cancel(Request $request, string $id): JsonResponse
    {
        $this->requests->cancel($request->user(), $id);

        return ApiResponse::success(null, 'Request cancelled.');
    }

    /** POST /service-requests/{id}/select — pick a response; proceed to standard booking. */
    public function select(Request $request, string $id): JsonResponse
    {
        $request->validate(['response_id' => ['required', 'uuid']]);

        $result = $this->requests->select($request->user(), $id, $request->string('response_id')->toString());

        return ApiResponse::success($result, 'Provider selected — continue to booking.');
    }

    /** GET /provider/service-requests — the provider's live request feed. */
    public function providerFeed(Request $request): JsonResponse
    {
        return ApiResponse::success($this->requests->feedForProvider($request->user()), 'Request feed retrieved.');
    }

    /** POST /provider/service-requests/{id}/respond — accept-at-price or quote. */
    public function respond(RespondServiceRequestRequest $request, string $id): JsonResponse
    {
        $response = $this->requests->respond($request->user(), $id, $request->validated());

        return ApiResponse::success([
            'id'        => $response->id,
            'type'      => $response->type,
            'price_zmw' => (float) $response->price_zmw,
            'status'    => $response->status,
        ], 'Response sent.', 201);
    }
}
