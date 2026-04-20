<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Kyc\SubmitAddressRequest;
use App\Http\Requests\Kyc\SubmitDocumentRequest;
use App\Http\Requests\Kyc\SubmitTier1Request;
use App\Services\KycService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class KycController extends Controller
{
    public function __construct(private readonly KycService $kyc) {}

    /**
     * GET /api/kyc/status
     * Returns current tier, kyc_status, and submitted document list.
     */
    public function status(Request $request): JsonResponse
    {
        $status = $this->kyc->getStatus($request->user());
        return ApiResponse::success($status, 'KYC status retrieved.');
    }

    /**
     * POST /api/kyc/tier1
     * Selfie + legal name → Tier 1 (immediate approval).
     */
    public function submitTier1(SubmitTier1Request $request): JsonResponse
    {
        $doc = $this->kyc->submitTier1(
            user:      $request->user(),
            legalName: $request->validated('legal_name'),
            selfie:    $request->file('selfie'),
        );

        return ApiResponse::success(
            ['document_id' => $doc->id, 'status' => $doc->status],
            'Identity step 1 approved. You can now list services.',
            201,
        );
    }

    /**
     * POST /api/kyc/document
     * Government ID + live selfie → dispatches async verification (Tier 2).
     */
    public function submitDocument(SubmitDocumentRequest $request): JsonResponse
    {
        $doc = $this->kyc->submitDocument(
            user:          $request->user(),
            documentImage: $request->file('document'),
            selfieImage:   $request->file('selfie'),
            docType:       $request->validated('doc_type'),
        );

        return ApiResponse::success(
            ['document_id' => $doc->id, 'status' => $doc->status],
            'Document submitted. Verification is in progress — we\'ll notify you within 24 hours.',
            202,
        );
    }

    /**
     * POST /api/kyc/address
     * Proof of address → queued for manual review (Tier 3).
     */
    public function submitAddress(SubmitAddressRequest $request): JsonResponse
    {
        $doc = $this->kyc->submitAddress(
            user:     $request->user(),
            document: $request->file('document'),
        );

        return ApiResponse::success(
            ['document_id' => $doc->id, 'status' => $doc->status],
            'Proof of address submitted for review.',
            202,
        );
    }
}
