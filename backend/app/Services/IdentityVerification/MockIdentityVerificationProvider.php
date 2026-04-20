<?php

namespace App\Services\IdentityVerification;

use App\Contracts\IdentityVerificationProviderInterface;
use App\Contracts\VerificationResult;
use Illuminate\Http\UploadedFile;

/**
 * Deterministic stub used in local development and CI.
 *
 * Behaviour is controlled by the filename prefix of the document image:
 *   - "reject_"  → returns a failed result (confidence 0.20, flags set)
 *   - "manual_"  → returns a low-confidence result that routes to manual review
 *   - anything else → returns a clean pass (confidence 0.95, face match 0.92)
 *
 * In production, bind SmileIdVerificationProvider (or equivalent) instead.
 */
class MockIdentityVerificationProvider implements IdentityVerificationProviderInterface
{
    public function verifyDocument(
        UploadedFile $documentImage,
        UploadedFile $selfieImage,
        string       $docType,
    ): VerificationResult {
        $filename = strtolower($documentImage->getClientOriginalName());

        if (str_starts_with($filename, 'reject_')) {
            return new VerificationResult(
                confidence:        0.20,
                documentAuthentic: false,
                faceMatchScore:    0.40,
                extractedName:     null,
                extractedDocNumber:null,
                extractedDob:      null,
                flags:             ['photo_swap'],
            );
        }

        if (str_starts_with($filename, 'manual_')) {
            return new VerificationResult(
                confidence:        0.60,
                documentAuthentic: true,
                faceMatchScore:    0.75,
                extractedName:     'John Doe',
                extractedDocNumber:'123456/78/9',
                extractedDob:      '1998-04-12',
                flags:             [],
            );
        }

        // Happy-path pass
        return new VerificationResult(
            confidence:        0.95,
            documentAuthentic: true,
            faceMatchScore:    0.92,
            extractedName:     'John Doe',
            extractedDocNumber:'123456/78/9',
            extractedDob:      '1998-04-12',
            flags:             [],
        );
    }

    public function livenessCheck(UploadedFile $selfie, string $referenceImagePath): float
    {
        return 0.93;
    }
}
