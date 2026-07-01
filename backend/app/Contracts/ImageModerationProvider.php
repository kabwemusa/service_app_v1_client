<?php

namespace App\Contracts;

use Illuminate\Http\UploadedFile;

/**
 * §5.3 image pipeline for provider-supplied showcase images (portfolio).
 *
 * Kept behind an interface like the KYC providers (IdentityVerificationProvider)
 * so the domain never depends on a concrete classifier. Dev/test binds a stub;
 * production swaps in a real NSFW classifier + perceptual-hash reverse-image
 * search without touching the submission flow.
 */
interface ImageModerationProvider
{
    /**
     * Run one image through the pipeline.
     *
     * @return ImageModerationResult
     */
    public function inspect(UploadedFile $image): ImageModerationResult;
}
