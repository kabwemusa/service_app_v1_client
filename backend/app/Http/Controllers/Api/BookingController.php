<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Booking\OpenDisputeRequest;
use App\Http\Requests\Booking\StoreBookingRequest;
use App\Http\Resources\BookingResource;
use App\Services\BookingService;
use App\Services\DisputeService;
use App\Support\ApiResponse;
use App\Support\PhoneNumber;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BookingController extends Controller
{
    public function __construct(
        private readonly BookingService  $bookings,
        private readonly DisputeService  $disputes,
        private readonly \App\Services\Growth\CampaignDiscountService $campaignDiscount,
    ) {}

    /** GET /bookings */
    public function index(Request $request): JsonResponse
    {
        $paginator = $this->bookings->list($request->user());

        return ApiResponse::success([
            'data'         => BookingResource::collection($paginator->getCollection()),
            'current_page' => $paginator->currentPage(),
            'last_page'    => $paginator->lastPage(),
            'per_page'     => $paginator->perPage(),
            'total'        => $paginator->total(),
        ], 'Bookings retrieved.');
    }

    /** GET /provider/requests */
    public function incomingRequests(Request $request): JsonResponse
    {
        return ApiResponse::success($this->bookings->incomingRequests($request->user()), 'Incoming requests retrieved.');
    }

    /** POST /bookings */
    public function store(StoreBookingRequest $request): JsonResponse
    {
        $data = $request->validated();

        // Double-submit protection (CON-1): accept an Idempotency-Key from the
        // header (preferred) or the body. A retried create with the same key
        // returns the original booking instead of a duplicate.
        $data['idempotency_key'] = $request->header('Idempotency-Key') ?: ($data['idempotency_key'] ?? null);

        $booking = $this->bookings->create($request->user(), $data);
        return ApiResponse::success(new BookingResource($booking), 'Booking created.', 201);
    }

    /** GET /bookings/{id} */
    public function show(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->findOrFail($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Booking retrieved.');
    }

    /**
     * GET /bookings/{id}/checkout-preview — the checkout price breakdown for the
     * customer: original price, any campaign / promo-code discount, and what they
     * pay. Server-computed and non-mutating (eligibility is re-checked and the
     * discount re-applied for real at pay time). Returns null discount when
     * nothing applies. The provider payout is never affected.
     */
    public function checkoutPreview(Request $request, string $id): JsonResponse
    {
        $request->validate(['code' => ['sometimes', 'nullable', 'string', 'max:40']]);

        $user    = $request->user();
        $booking = $this->bookings->findOrFail($id, $user);

        $amount    = (float) ($booking->agreed_amount ?? $booking->amount ?? 0);
        $fee       = (float) ($booking->buyer_protection_fee ?? 0);
        $code      = $request->query('code');
        $promo     = $this->campaignDiscount->preview($booking, $code, $user);
        $discount  = $promo['discount_zmw'] ?? 0.0;

        return ApiResponse::success([
            'original_zmw'       => round($amount, 2),
            'service_fee_zmw'    => round($fee, 2),
            'discount_zmw'       => round((float) $discount, 2),
            'total_zmw'          => round(max(0.0, $amount + $fee - (float) $discount), 2),
            'campaign' => $promo ? [
                'id'         => $promo['campaign_id'],
                'name'       => $promo['name'],
                'offer_type' => $promo['offer_type'],
            ] : null,
            'code_invalid'       => $code !== null && trim($code) !== '' && $promo === null,
        ], 'Checkout preview.');
    }

    /**
     * POST /bookings/{id}/scope-attachments — customer adds photos/a short
     * video to a quote-first brief so the provider has visual context to
     * price the job. Buyer-only; the brief must still be open.
     */
    public function addScopeAttachments(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'files'   => ['required', 'array', 'min:1', 'max:6'],
            'files.*' => ['required', 'file', 'mimes:jpeg,jpg,png,webp,mp4,mov,quicktime', 'max:25600'],
        ]);

        $booking = $this->bookings->addScopeAttachments($id, $request->user(), $request->file('files'));

        return ApiResponse::success(new BookingResource($booking), 'Attachments added.');
    }

    /**
     * GET /bookings/{id}/scope-attachments/{index} — stream a private scope
     * attachment (customer's home/property photo or short video) to a party of
     * the booking only. The files live on the private disk (§ SEC-4); this is
     * the sole authorized read path.
     */
    public function scopeAttachment(Request $request, string $id, int $index): mixed
    {
        return $this->bookings->streamScopeAttachment($id, $request->user(), $index);
    }

    /**
     * POST /bookings/{id}/pay — ESCROW: hold funds via the PaymentGateway.
     *
     * Buyer funds the booking: REQUESTED/QUOTED → PENDING_PAYMENT (PawaPay deposit
     * initiated, MoMo USSD push sent; the PawaPay callback advances to FUNDS_HELD)
     * or → FUNDS_HELD directly when the gateway is synchronous (stub/test).
     *
     * `momo_number` is optional — lets the buyer send the collection request to a
     * different Mobile Money wallet than their account phone (e.g. a shared family
     * line, or their own number is down). Falls back to the account phone when omitted.
     */
    public function pay(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'momo_number' => ['sometimes', 'nullable', 'string'],
            'promo_code'  => ['sometimes', 'nullable', 'string', 'max:40'],
        ]);

        $momoNumber = null;
        if (! empty($data['momo_number'])) {
            $momoNumber = PhoneNumber::normalize($data['momo_number']);
            if (! $momoNumber) {
                return ApiResponse::error(
                    'Enter a valid Zambian Mobile Money number (e.g. 0977123456).',
                    'VALIDATION_ERROR',
                    422,
                );
            }
        }

        $booking = $this->bookings->holdFunds($id, $request->user(), $momoNumber, $data['promo_code'] ?? null);

        $message = $booking->status === 'PENDING_PAYMENT'
            ? 'Check your phone — approve the mobile-money prompt to pay.'
            : 'Payment confirmed. Your money is held safely until the job is done.';

        return ApiResponse::success(new BookingResource($booking), $message);
    }

    /** POST /bookings/{id}/accept — DIRECT: provider accepts at listed price */
    public function accept(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->accept($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Booking accepted.');
    }

    /**
     * POST /bookings/{id}/quote — provider sends a quote.
     * PROVIDER_SCOPE / QUOTE_DEPOSIT: a scoped quote (price + duration + what's
     * included) against the customer's brief — SCOPE_PENDING → QUOTE_SENT.
     * Legacy/priced models: an alternate-price quote — REQUESTED → QUOTED.
     */
    public function quote(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'quoted_amount'  => ['required', 'numeric', 'min:1'],
            'duration_mins'  => ['sometimes', 'nullable', 'integer', 'min:15', 'max:10080'],
            'inclusions'     => ['sometimes', 'array', 'max:20'],
            'inclusions.*'   => ['string', 'max:120'],
            'message'        => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $booking = $this->bookings->quote(
            $id,
            $request->user(),
            (float) $data['quoted_amount'],
            $data['message'] ?? null,
            isset($data['duration_mins']) ? (int) $data['duration_mins'] : null,
            $data['inclusions'] ?? [],
        );
        return ApiResponse::success(new BookingResource($booking), 'Quote sent to buyer.');
    }

    /** POST /bookings/{id}/accept-quote — DIRECT: buyer confirms provider's quote */
    public function acceptQuote(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->acceptQuote($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Quote accepted.');
    }

    /**
     * POST /bookings/{id}/approve-quote — customer approves the scoped quote
     * (QUOTE_SENT). Escrow hold starts here: full amount, or the deposit for
     * QUOTE_DEPOSIT services. Optional momo_number override as with /pay.
     */
    public function approveQuote(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'momo_number' => ['sometimes', 'nullable', 'string'],
            'promo_code'  => ['sometimes', 'nullable', 'string', 'max:40'],
        ]);

        $momoNumber = null;
        if (! empty($data['momo_number'])) {
            $momoNumber = PhoneNumber::normalize($data['momo_number']);
            if (! $momoNumber) {
                return ApiResponse::error(
                    'Enter a valid Zambian Mobile Money number (e.g. 0977123456).',
                    'VALIDATION_ERROR',
                    422,
                );
            }
        }

        $booking = $this->bookings->approveQuote($id, $request->user(), $momoNumber, $data['promo_code'] ?? null);

        $message = $booking->status === 'PENDING_PAYMENT'
            ? 'Check your phone — approve the mobile-money prompt to pay.'
            : 'Quote approved. Your money is held safely until the job is done.';

        return ApiResponse::success(new BookingResource($booking), $message);
    }

    /** POST /bookings/{id}/decline-quote — customer declines the scoped quote; no charge. */
    public function declineQuote(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->declineQuote($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Quote declined — booking cancelled, nothing was charged.');
    }

    /** POST /bookings/{id}/decline — DIRECT: provider declines */
    public function decline(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->decline($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Booking declined.');
    }

    /** POST /bookings/{id}/mark-paid — DIRECT: record that direct payment was made */
    public function markPaid(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->markPaid($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Payment recorded.');
    }

    /** POST /bookings/{id}/start */
    public function start(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->markInProgress($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Booking marked as in progress.');
    }

    /**
     * POST /bookings/{id}/deliver — the HOURLY_CAPPED "Finish" tap.
     * No hours input: the elapsed time is computed server-side from the start/stop
     * timestamps. The customer is never asked for hours, and the provider can't
     * self-report them.
     */
    public function deliver(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->markDelivered($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Booking marked as delivered.');
    }

    /** POST /bookings/{id}/pause — HOURLY_CAPPED: pause the observed timer. */
    public function pauseTimer(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->pauseJob($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Job timer paused.');
    }

    /** POST /bookings/{id}/resume — HOURLY_CAPPED: resume the observed timer. */
    public function resumeTimer(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->resumeJob($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Job timer resumed.');
    }

    /** POST /bookings/{id}/request-cap-extension — provider asks the customer to approve more time. */
    public function requestCapExtension(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->requestCapExtension($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Extension request sent to the customer.');
    }

    /**
     * POST /bookings/{id}/approve-cap-extension — customer re-authorises a higher
     * hold (additional_hours × rate) so the cap can be raised. Optional momo_number.
     */
    public function approveCapExtension(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'additional_hours' => ['required', 'numeric', 'min:0.5', 'max:24', 'multiple_of:0.5'],
            'momo_number'      => ['sometimes', 'nullable', 'string'],
        ]);

        $momoNumber = null;
        if (! empty($data['momo_number'])) {
            $momoNumber = PhoneNumber::normalize($data['momo_number']);
            if (! $momoNumber) {
                return ApiResponse::error('Enter a valid Zambian Mobile Money number (e.g. 0977123456).', 'VALIDATION_ERROR', 422);
            }
        }

        $booking = $this->bookings->approveCapExtension($id, $request->user(), (float) $data['additional_hours'], $momoNumber);

        $message = $booking->status === 'PENDING_PAYMENT'
            ? 'Check your phone — approve the mobile-money prompt for the extra time.'
            : 'Extension approved — the cap has been raised.';

        return ApiResponse::success(new BookingResource($booking), $message);
    }

    /** POST /bookings/{id}/complete */
    public function complete(Request $request, string $id): JsonResponse
    {
        $booking  = $this->bookings->complete($id, $request->user());
        $isDirect = ($booking->payment_mode ?? 'ESCROW') === 'DIRECT';
        $message  = $isDirect
            ? 'Booking completed.'
            : 'Booking completed. Payout hold started.';
        return ApiResponse::success(new BookingResource($booking), $message);
    }

    /** POST /bookings/{id}/instant-payout — provider requests instant payout (Tier 3+, ESCROW only) */
    public function instantPayout(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->requestInstantPayout($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Instant payout initiated (1% fee applied).');
    }

    /** POST /bookings/{id}/dispute */
    public function dispute(OpenDisputeRequest $request, string $id): JsonResponse
    {
        $booking = $this->bookings->findOrFail($id, $request->user());
        $dispute = $this->disputes->open($booking, $request->user(), $request->validated());
        return ApiResponse::success([
            'booking' => new BookingResource($booking->fresh()->load(['service', 'buyer', 'provider', 'transactions', 'commission', 'dispute'])),
            'dispute' => $dispute,
        ], 'Dispute opened.');
    }

    /** POST /bookings/{id}/cancel */
    public function cancel(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->cancel($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Booking cancelled.');
    }

    /** POST /bookings/{id}/review — buyer leaves a rating + comment for a completed booking */
    public function review(Request $request, string $id): JsonResponse
    {
        $validated = $request->validate([
            'rating'  => ['required', 'numeric', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string', 'max:1000'],
        ]);

        $booking = $this->bookings->review(
            $id,
            $request->user(),
            (float) $validated['rating'],
            $validated['comment'] ?? null,
        );

        return ApiResponse::success(new BookingResource($booking), 'Thanks for your review.');
    }

    /**
     * GET /me/providers
     */
    public function myProviders(Request $request): JsonResponse
    {
        $userId = $request->user()->id;

        $rows = DB::select("
            SELECT DISTINCT ON (b.provider_id)
                b.provider_id  AS id,
                pp.display_name,
                pp.avatar_url,
                pp.trust_tier,
                u.r_raw,
                u.v_reviews
            FROM bookings b
            JOIN users            u  ON u.id        = b.provider_id
            JOIN provider_profiles pp ON pp.user_id = b.provider_id
            WHERE b.buyer_id = ?
              AND b.status   = 'COMPLETED'
            ORDER BY b.provider_id, b.updated_at DESC
            LIMIT 8
        ", [$userId]);

        return ApiResponse::success(
            array_map(fn ($r) => [
                'id'           => $r->id,
                'display_name' => $r->display_name,
                'avatar_url'   => $r->avatar_url,
                'trust_tier'   => (int) $r->trust_tier,
                'r_raw'        => round((float) $r->r_raw, 2),
                'v_reviews'    => (int) $r->v_reviews,
            ], $rows),
            'My providers retrieved.'
        );
    }

    /**
     * GET /me/book-again — v3.2 §2.3
     */
    public function bookAgain(Request $request): JsonResponse
    {
        $row = DB::selectOne("
            SELECT
                b.id              AS booking_id,
                b.completed_at,
                b.delivery_location_label,
                b.delivery_location_region,
                ST_Y(b.delivery_location::geometry) AS delivery_lat,
                ST_X(b.delivery_location::geometry) AS delivery_lng,
                s.id              AS service_id,
                s.title           AS service_title,
                s.pricing_model,
                s.base_price,
                cat.name          AS category_name,
                p.id              AS provider_id,
                pp.display_name   AS provider_name,
                pp.avatar_url     AS provider_avatar_url,
                pp.trust_tier
            FROM bookings b
            JOIN services          s   ON s.id       = b.service_id
            JOIN categories        cat ON cat.id     = s.category_id
            JOIN users             p   ON p.id       = b.provider_id
            JOIN provider_profiles pp  ON pp.user_id = b.provider_id
            WHERE b.buyer_id = ?
              AND b.status   = 'COMPLETED'
              AND s.status   = 'ACTIVE'
              AND p.account_state = 'ACTIVE'
              AND pp.trust_tier  >= 1
            ORDER BY b.completed_at DESC NULLS LAST
            LIMIT 1
        ", [$request->user()->id]);

        return ApiResponse::success($row ? [
            'booking_id'   => $row->booking_id,
            'completed_at' => $row->completed_at,
            'service' => [
                'id'            => $row->service_id,
                'title'         => $row->service_title,
                'pricing_model' => $row->pricing_model,
                'base_price'    => $row->base_price !== null ? (float) $row->base_price : null,
                'category_name' => $row->category_name,
            ],
            'provider' => [
                'id'           => $row->provider_id,
                'display_name' => $row->provider_name,
                'avatar_url'   => $row->provider_avatar_url,
                'trust_tier'   => (int) $row->trust_tier,
            ],
            'delivery' => [
                'label'  => $row->delivery_location_label,
                'region' => $row->delivery_location_region,
                'lat'    => $row->delivery_lat !== null ? (float) $row->delivery_lat : null,
                'lng'    => $row->delivery_lng !== null ? (float) $row->delivery_lng : null,
            ],
        ] : null, 'Book-again card retrieved.');
    }
}
