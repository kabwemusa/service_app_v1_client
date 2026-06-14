<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\NotFoundException;
use App\Models\ServiceRequest;
use App\Models\ServiceRequestResponse;
use App\Models\ServiceRequestTarget;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * v3.2 §6 — post-a-request (reverse flow).
 *
 * Create: the buyer broadcasts category + description + delivery location +
 * time window (+ optional budget). The STANDARD candidate pipeline (same hard
 * filters and corrected scorer as search — no separate matching logic) picks
 * the top-10 providers, who are notified with a 30-minute response deadline.
 *
 * Respond: accept-at-listed-price or quote (§5.5 QUOTE semantics). Select:
 * buyer picks one response; downstream booking/escrow is the unchanged
 * standard flow (client books the selected service at the quoted price).
 *
 * Deadline performance feeds response_rate_7d via the nightly trust job.
 */
class ServiceRequestService
{
    public function __construct(private readonly SearchService $search) {}

    // ── Create + broadcast ───────────────────────────────────────────────────

    public function create(User $buyer, array $data): ServiceRequest
    {
        $cfg = config('search.service_requests');

        $openCount = ServiceRequest::where('buyer_id', $buyer->id)->where('status', 'OPEN')->count();
        if ($openCount >= (int) $cfg['max_open_per_buyer']) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                "You can have up to {$cfg['max_open_per_buyer']} open requests. Cancel one before posting another.",
            );
        }

        $request = DB::transaction(function () use ($buyer, $data) {
            $request = ServiceRequest::create([
                'buyer_id'                 => $buyer->id,
                'category_id'              => $data['category_id'],
                'description'              => $data['description'],
                'delivery_location_label'  => $data['delivery_label'] ?? null,
                'delivery_location_region' => $data['delivery_region'] ?? null,
                'delivery_location_source' => $data['delivery_source'] ?? null,
                'window_start'             => $data['window_start'],
                'window_end'               => $data['window_end'],
                'budget_zmw'               => $data['budget_zmw'] ?? null,
                'status'                   => 'OPEN',
            ]);

            DB::statement(
                "UPDATE service_requests
                 SET delivery_location = ST_GeogFromText('POINT(' || ? || ' ' || ? || ')')
                 WHERE id = ?",
                [$data['delivery_lng'], $data['delivery_lat'], $request->id],
            );

            return $request;
        });

        $this->broadcast($request, (float) $data['delivery_lat'], (float) $data['delivery_lng']);

        return $request->fresh(['targets']);
    }

    /**
     * Run the standard candidate pipeline against the delivery location and
     * notify the top-N eligible providers. Notification rows are written to
     * the in-app notifications table; FCM/SMS dispatch plugs in here when the
     * push infrastructure (v2 §8) lands.
     */
    private function broadcast(ServiceRequest $request, float $lat, float $lng): void
    {
        $cfg = config('search.service_requests');

        $results = $this->search->search([
            'lat'         => $lat,
            'lng'         => $lng,
            'category_id' => (int) $request->category_id,
            'region'      => $request->delivery_location_region,
        ]);

        $deadline = now()->addMinutes((int) $cfg['response_deadline_mins']);
        $targeted = 0;
        $seen     = [];

        foreach ($results['data'] as $row) {
            if ($targeted >= (int) $cfg['notify_top_n']) {
                break;
            }
            if (isset($seen[$row->provider_id])) {
                continue; // one slot per provider — their best-ranked service
            }
            $seen[$row->provider_id] = true;

            try {
                ServiceRequestTarget::create([
                    'request_id'  => $request->id,
                    'provider_id' => $row->provider_id,
                    'service_id'  => $row->id,
                    'notified_at' => now(),
                    'respond_by'  => $deadline,
                ]);

                DB::table('notifications')->insert([
                    'id'      => DB::raw('gen_random_uuid()'),
                    'user_id' => $row->provider_id,
                    'type'    => 'SERVICE_REQUEST',
                    'title'   => 'New job request near you',
                    'body'    => mb_substr($request->description, 0, 120)
                               . ($request->budget_zmw ? " · Budget ZMW {$request->budget_zmw}" : '')
                               . " · Reply within {$cfg['response_deadline_mins']} min",
                    'sent_at'    => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                $targeted++;
            } catch (\Throwable $e) {
                Log::warning('ServiceRequestService::broadcast target failed', [
                    'request_id'  => $request->id,
                    'provider_id' => $row->provider_id,
                    'error'       => $e->getMessage(),
                ]);
            }
        }

        Log::info('ServiceRequestService: request broadcast', [
            'request_id' => $request->id,
            'targeted'   => $targeted,
        ]);
    }

    // ── Buyer side ───────────────────────────────────────────────────────────

    public function listForBuyer(User $buyer): array
    {
        return ServiceRequest::with(['category:id,name', 'responses'])
            ->where('buyer_id', $buyer->id)
            ->orderByDesc('created_at')
            ->limit(20)
            ->get()
            ->map(fn (ServiceRequest $r) => $this->buyerShape($r))
            ->all();
    }

    public function showForBuyer(User $buyer, string $id): array
    {
        return $this->buyerShape($this->findOwned($buyer, $id), withResponses: true);
    }

    public function cancel(User $buyer, string $id): ServiceRequest
    {
        $request = $this->findOwned($buyer, $id);

        if ($request->status !== 'OPEN') {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Only open requests can be cancelled.');
        }

        $request->update(['status' => 'CANCELLED']);

        return $request->fresh();
    }

    /**
     * Buyer picks one response. The request closes as MATCHED and the client
     * proceeds through the unchanged standard booking flow for the selected
     * service (escrow etc. untouched — §6).
     */
    public function select(User $buyer, string $id, string $responseId): array
    {
        $request = $this->findOwned($buyer, $id);

        if ($request->status !== 'OPEN') {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'This request is no longer open.');
        }

        $response = ServiceRequestResponse::where('id', $responseId)
            ->where('request_id', $request->id)
            ->first();

        if (! $response) {
            throw new NotFoundException('Response');
        }

        DB::transaction(function () use ($request, $response) {
            $response->update(['status' => 'SELECTED']);
            ServiceRequestResponse::where('request_id', $request->id)
                ->where('id', '!=', $response->id)
                ->update(['status' => 'DECLINED']);
            $request->update(['status' => 'MATCHED']);
        });

        return [
            'request'  => $this->buyerShape($request->fresh()),
            // Everything the client needs to enter the standard booking flow
            'selected' => [
                'response_id' => $response->id,
                'service_id'  => $response->service_id,
                'provider_id' => $response->provider_id,
                'price_zmw'   => (float) $response->price_zmw,
                'type'        => $response->type,
            ],
        ];
    }

    // ── Provider side ────────────────────────────────────────────────────────

    /** The provider's live request feed (targets on OPEN requests, newest first). */
    public function feedForProvider(User $provider): array
    {
        $rows = DB::select("
            SELECT
                sr.id            AS request_id,
                sr.description,
                sr.window_start,
                sr.window_end,
                sr.budget_zmw,
                sr.delivery_location_label,
                sr.delivery_location_region,
                sr.created_at,
                cat.name         AS category_name,
                t.service_id,
                t.respond_by,
                t.responded_at,
                s.title          AS service_title,
                s.base_price,
                s.pricing_model,
                r.id             AS my_response_id,
                r.type           AS my_response_type,
                r.price_zmw      AS my_response_price
            FROM service_request_targets t
            JOIN service_requests sr ON sr.id = t.request_id
            JOIN categories cat      ON cat.id = sr.category_id
            JOIN services s          ON s.id  = t.service_id
            LEFT JOIN service_request_responses r
                ON r.request_id = t.request_id AND r.provider_id = t.provider_id
            WHERE t.provider_id = ?
              AND sr.status     = 'OPEN'
            ORDER BY t.notified_at DESC
            LIMIT 30
        ", [$provider->id]);

        return array_map(fn ($row) => [
            'request_id'      => $row->request_id,
            'category_name'   => $row->category_name,
            'description'     => $row->description,
            'window_start'    => $row->window_start,
            'window_end'      => $row->window_end,
            'budget_zmw'      => $row->budget_zmw !== null ? (float) $row->budget_zmw : null,
            'delivery_label'  => $row->delivery_location_label,
            'delivery_region' => $row->delivery_location_region,
            'respond_by'      => $row->respond_by,
            'responded_at'    => $row->responded_at,
            'service'         => [
                'id'            => $row->service_id,
                'title'         => $row->service_title,
                'base_price'    => $row->base_price !== null ? (float) $row->base_price : null,
                'pricing_model' => $row->pricing_model,
            ],
            'my_response'     => $row->my_response_id ? [
                'id'        => $row->my_response_id,
                'type'      => $row->my_response_type,
                'price_zmw' => (float) $row->my_response_price,
            ] : null,
        ], $rows);
    }

    /** Accept at listed price, or quote (§5.5 QUOTE semantics). */
    public function respond(User $provider, string $requestId, array $data): ServiceRequestResponse
    {
        $target = ServiceRequestTarget::where('request_id', $requestId)
            ->where('provider_id', $provider->id)
            ->first();

        if (! $target) {
            throw new NotFoundException('Request');
        }

        $request = ServiceRequest::find($requestId);
        if (! $request || $request->status !== 'OPEN') {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'This request is no longer open.');
        }

        $existing = ServiceRequestResponse::where('request_id', $requestId)
            ->where('provider_id', $provider->id)
            ->exists();
        if ($existing) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'You have already responded to this request.');
        }

        $type = $data['type'];

        // ACCEPT means "at the listed price" — derive it from the targeted service.
        $price = $type === 'ACCEPT'
            ? (float) DB::table('services')->where('id', $target->service_id)->value('base_price')
            : (float) $data['price_zmw'];

        if ($price <= 0) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'This service has no listed price — send a quote instead.',
            );
        }

        $response = DB::transaction(function () use ($requestId, $provider, $target, $type, $price, $data) {
            $target->update(['responded_at' => now()]);

            return ServiceRequestResponse::create([
                'request_id'  => $requestId,
                'provider_id' => $provider->id,
                'service_id'  => $target->service_id,
                'type'        => $type,
                'price_zmw'   => $price,
                'message'     => $data['message'] ?? null,
                'status'      => 'PENDING',
                'created_at'  => now(),
            ]);
        });

        // Tell the buyer someone replied.
        try {
            DB::table('notifications')->insert([
                'id'      => DB::raw('gen_random_uuid()'),
                'user_id' => ServiceRequest::find($requestId)->buyer_id,
                'type'    => 'SERVICE_REQUEST',
                'title'   => 'A provider replied to your request',
                'body'    => ($type === 'ACCEPT' ? 'Accepted at ' : 'Quoted ') . "ZMW {$price}",
                'sent_at'    => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('ServiceRequestService::respond notify failed', ['error' => $e->getMessage()]);
        }

        return $response;
    }

    // ── Maintenance ──────────────────────────────────────────────────────────

    /** OPEN requests past their window close as EXPIRED (scheduled). */
    public function expireStale(): int
    {
        return ServiceRequest::where('status', 'OPEN')
            ->where('window_end', '<', now())
            ->update(['status' => 'EXPIRED']);
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function findOwned(User $buyer, string $id): ServiceRequest
    {
        $request = ServiceRequest::with(['category:id,name'])
            ->where('id', $id)
            ->where('buyer_id', $buyer->id)
            ->first();

        if (! $request) {
            throw new NotFoundException('Request');
        }

        return $request;
    }

    private function buyerShape(ServiceRequest $request, bool $withResponses = false): array
    {
        $shape = [
            'id'             => $request->id,
            'category'       => ['id' => $request->category_id, 'name' => $request->category?->name],
            'description'    => $request->description,
            'delivery_label' => $request->delivery_location_label,
            'window_start'   => $request->window_start?->toIso8601String(),
            'window_end'     => $request->window_end?->toIso8601String(),
            'budget_zmw'     => $request->budget_zmw,
            'status'         => $request->status,
            'created_at'     => $request->created_at?->toIso8601String(),
            'response_count' => $request->responses()->count(),
        ];

        if ($withResponses) {
            $shape['responses'] = $request->responses()
                ->with(['provider.providerProfile:user_id,display_name,avatar_url,trust_tier', 'service:id,title'])
                ->orderBy('created_at')
                ->get()
                ->map(fn (ServiceRequestResponse $r) => [
                    'id'         => $r->id,
                    'type'       => $r->type,
                    'price_zmw'  => (float) $r->price_zmw,
                    'message'    => $r->message,
                    'status'     => $r->status,
                    'created_at' => $r->created_at?->toIso8601String(),
                    'service'    => ['id' => $r->service_id, 'title' => $r->service?->title],
                    'provider'   => [
                        'id'           => $r->provider_id,
                        'display_name' => $r->provider?->providerProfile?->display_name,
                        'avatar_url'   => $r->provider?->providerProfile?->avatar_url,
                        'trust_tier'   => (int) ($r->provider?->providerProfile?->trust_tier ?? 0),
                        'r_raw'        => round((float) ($r->provider?->r_raw ?? 0), 2),
                        'v_reviews'    => (int) ($r->provider?->v_reviews ?? 0),
                    ],
                ])
                ->all();
        }

        return $shape;
    }
}
