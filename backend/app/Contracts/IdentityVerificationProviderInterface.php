<?php

namespace App\Contracts;

use Illuminate\Http\UploadedFile;

/**
 * Abstraction over Smile ID / Youverse / Regula or any equivalent provider.
 * Swap the binding in AppServiceProvider to change the provider without
 * touching any business logic.
 */
interface IdentityVerificationProviderInterface
{
    /**
     * Verify a government-issued identity document.
     *
     * @param  UploadedFile  $documentImage  Front face of the document.
     * @param  UploadedFile  $selfieImage    Live selfie taken in-session.
     * @param  string        $docType        e.g. 'NRC', 'PASSPORT', 'DRIVERS_LICENSE'
     *
     * @return VerificationResult
     */
    public function verifyDocument(
        UploadedFile $documentImage,
        UploadedFile $selfieImage,
        string       $docType,
    ): VerificationResult;

    /**
     * Run only a liveness check (selfie vs reference image already on file).
     *
     * @param  UploadedFile  $selfie
     * @param  string        $referenceImagePath  S3 key of previously stored selfie.
     *
     * @return float  Confidence score 0–1
     */
    public function livenessCheck(UploadedFile $selfie, string $referenceImagePath): float;
}

/**
 * Typed value object returned by the verification provider.
 */
readonly class VerificationResult
{
    public function __construct(
        public float   $confidence,        // 0.00 – 1.00
        public bool    $documentAuthentic, // passed authenticity checks
        public float   $faceMatchScore,    // 0.00 – 1.00, selfie vs doc face
        public ?string $extractedName,
        public ?string $extractedDocNumber,
        public ?string $extractedDob,
        public array   $flags,             // e.g. ['photo_swap', 'digital_recapture']
    ) {}

    public function passed(float $minConfidence = 0.80, float $minFaceMatch = 0.85): bool
    {
        return $this->documentAuthentic
            && $this->confidence >= $minConfidence
            && $this->faceMatchScore >= $minFaceMatch
            && empty($this->flags);
    }

    public function isLowConfidence(float $minConfidence = 0.80): bool
    {
        return !$this->passed($minConfidence)
            && $this->confidence >= 0.50;
    }
}
