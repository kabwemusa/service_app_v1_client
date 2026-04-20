<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Booking\OpenDisputeRequest;
use App\Http\Requests\Booking\StoreBookingRequest;
use App\Http\Resources\BookingResource;
use App\Services\BookingService;
use App\Services\DisputeService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BookingController extends Controller
{
    public function __construct(
        private readonly BookingService  $bookings,
        private readonly DisputeService  $disputes,
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

    /** POST /bookings */
    public function store(StoreBookingRequest $request): JsonResponse
    {
        $booking = $this->bookings->create($request->user(), $request->validated());
        return ApiResponse::success(new BookingResource($booking), 'Booking created.', 201);
    }

    /** GET /bookings/{id} */
    public function show(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->findOrFail($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Booking retrieved.');
    }

    /** POST /bookings/{id}/pay */
    public function pay(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->confirmPayment($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Payment confirmed. Funds held.');
    }

    /** POST /bookings/{id}/start */
    public function start(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->markInProgress($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Booking marked as in progress.');
    }

    /** POST /bookings/{id}/deliver */
    public function deliver(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->markDelivered($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Booking marked as delivered.');
    }

    /** POST /bookings/{id}/complete */
    public function complete(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->complete($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Booking completed. Payout hold started.');
    }

    /** POST /bookings/{id}/instant-payout — provider requests instant payout (Tier 3+) */
    public function instantPayout(Request $request, string $id): JsonResponse
    {
        $booking = $this->bookings->requestInstantPayout($id, $request->user());
        return ApiResponse::success(new BookingResource($booking), 'Instant payout initiated (1% fee applied).');
    }

    /** POST /bookings/{id}/dispute — buyer opens a dispute (DELIVERED → DISPUTED) */
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
}
