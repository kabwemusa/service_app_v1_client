<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\AdminBookingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin Bookings module API (consumed by admin/src/lib/api/bookings.ts).
 * Capability gating: read:bookings. Read-only.
 */
class AdminBookingController extends Controller
{
    public function __construct(private readonly AdminBookingService $service) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->service->list([
            'page'         => $request->integer('page', 1),
            'search'       => $request->string('search')->toString(),
            'status'       => $request->string('status')->toString(),
            'payment_mode' => $request->string('payment_mode')->toString(),
            'disputed'     => $request->string('disputed')->toString(),
            'date_from'    => $request->string('date_from')->toString(),
        ]));
    }

    public function show(string $booking): JsonResponse
    {
        return response()->json($this->service->detail($booking));
    }
}
