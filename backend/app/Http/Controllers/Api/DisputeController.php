<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Dispute;
use App\Services\DisputeService;
use App\Services\InsuranceReserveService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class DisputeController extends Controller
{
    public function __construct(
        private readonly DisputeService          $disputes,
        private readonly InsuranceReserveService $reserve,
    ) {}

    /** GET /admin/disputes — admin/moderator queue */
    public function index(Request $request): JsonResponse
    {
        $status = $request->query('status', 'OPEN');

        $disputes = Dispute::with(['booking.service', 'raisedByUser', 'againstUser'])
            ->when($status !== 'all', fn ($q) => $q->where('status', $status))
            ->orderBy('opened_at')
            ->paginate(20);

        // Canonical pagination shape (§ API-1) — was a raw paginator with Laravel's
        // default meta nested differently from every other list endpoint.
        return ApiResponse::paginated($disputes, message: 'Disputes retrieved.');
    }

    /** GET /admin/disputes/{id} */
    public function show(string $id): JsonResponse
    {
        $dispute = Dispute::with(['booking.service', 'raisedByUser', 'againstUser'])->findOrFail($id);
        return ApiResponse::success($dispute, 'Dispute retrieved.');
    }

    /** POST /admin/disputes/{id}/resolve — admin/moderator grades the outcome */
    public function resolve(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'outcome'       => ['required', 'string', 'in:RESOLVED_BUYER,RESOLVED_PROVIDER,RESOLVED_PARTIAL,WITHDRAWN'],
            'refund_amount' => ['required_if:outcome,RESOLVED_PARTIAL', 'nullable', 'numeric', 'min:0.01'],
            'notes'         => ['required', 'string', 'min:10', 'max:2000'],
        ]);

        $dispute = $this->disputes->resolve($id, $request->user(), $data);

        return ApiResponse::success($dispute, 'Dispute resolved.');
    }

    /** POST /disputes/{id}/withdraw — buyer withdraws their own dispute */
    public function withdraw(Request $request, string $id): JsonResponse
    {
        $dispute = $this->disputes->withdraw($id, $request->user());
        return ApiResponse::success($dispute, 'Dispute withdrawn.');
    }

    /**
     * POST /disputes/{id}/evidence
     *
     * Upload one or more evidence files (photos, receipts). Files are stored
     * in S3-compatible object storage; their keys are appended to dispute.evidence.
     * Max 10 files per dispute, 5 MB each.
     */
    public function uploadEvidence(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'files'   => ['required', 'array', 'min:1', 'max:5'],
            'files.*' => ['required', 'file', 'max:5120', 'mimes:jpeg,png,webp,pdf'],
        ]);

        $dispute = Dispute::findOrFail($id);

        // Only the party who raised the dispute can upload evidence
        if ($dispute->raised_by !== $request->user()->id) {
            throw new \App\Exceptions\Api\ForbiddenException('You are not authorised to add evidence to this dispute.');
        }

        $existing = $dispute->evidence ?? [];
        if (count($existing) >= 10) {
            throw new \App\Exceptions\Api\ApiException(
                \App\Enums\ErrorCode::VALIDATION_ERROR,
                'Maximum 10 evidence files per dispute.',
            );
        }

        $keys = [];
        foreach ($request->file('files') as $file) {
            $key    = 'disputes/' . $dispute->id . '/' . Str::uuid() . '.' . $file->extension();
            Storage::disk('s3')->put($key, file_get_contents($file), 'private');
            $keys[] = $key;
        }

        $updated = array_slice(array_merge($existing, $keys), 0, 10);
        $dispute->update(['evidence' => $updated]);

        return ApiResponse::success(['evidence' => $updated], 'Evidence uploaded.');
    }

    /** GET /admin/insurance-reserve — insurance reserve summary */
    public function reserveSummary(): JsonResponse
    {
        return ApiResponse::success($this->reserve->summary(), 'Insurance reserve summary.');
    }
}
