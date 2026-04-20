<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SafetyReportService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SafetyReportController extends Controller
{
    public function __construct(private readonly SafetyReportService $reports) {}

    /** POST /safety-reports — any authenticated user can file a report */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'reported_id'     => ['required', 'uuid', 'exists:users,id'],
            'booking_id'      => ['sometimes', 'nullable', 'uuid', 'exists:bookings,id'],
            'category'        => ['required', 'string', 'in:HARASSMENT,VIOLENCE_THREAT,UNSAFE_BEHAVIOR,DISCRIMINATION,STOLEN_PROPERTY,OTHER'],
            'description'     => ['required', 'string', 'min:20', 'max:2000'],
            'tos_acknowledged'=> ['required', 'boolean', 'accepted'],
        ]);

        $report = $this->reports->file($request->user(), $data);

        return ApiResponse::success($report, 'Safety report filed. Our moderation team will review within 1 hour.', 201);
    }

    /** GET /admin/safety-reports — moderator queue */
    public function index(Request $request): JsonResponse
    {
        $paginator = $this->reports->queue($request->user());
        return ApiResponse::success($paginator, 'Safety reports retrieved.');
    }

    /** POST /admin/safety-reports/{id}/review — moderator resolves */
    public function review(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'outcome'          => ['required', 'string', 'in:RESOLVED,DISMISSED'],
            'review_notes'     => ['required', 'string', 'min:10', 'max:2000'],
            'lift_restriction' => ['sometimes', 'boolean'],
        ]);

        $report = $this->reports->review($id, $request->user(), $data);
        return ApiResponse::success($report, 'Safety report reviewed.');
    }
}
