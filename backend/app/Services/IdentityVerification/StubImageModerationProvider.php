<?php

namespace App\Services\IdentityVerification;

use App\Contracts\ImageModerationProvider;
use App\Contracts\ImageModerationResult;
use Illuminate\Http\UploadedFile;

/**
 * Deterministic dev/CI stub for the §5.3 image pipeline (mirrors
 * MockIdentityVerificationProvider). Behaviour keys off the filename prefix so
 * tests can force each branch:
 *   - "nsfw_"  → NSFW flagged (hard reject)
 *   - "dupe_"  → perceptual-hash duplicate (hard reject)
 *   - anything else → clean pass
 *
 * pHash here is a content-independent placeholder; a real provider returns a
 * true perceptual hash for cross-profile reverse-image search.
 */
class StubImageModerationProvider implements ImageModerationProvider
{
    public function inspect(UploadedFile $image): ImageModerationResult
    {
        $name = strtolower($image->getClientOriginalName());

        if (str_starts_with($name, 'nsfw_')) {
            return new ImageModerationResult(nsfwFlagged: true, nsfwScore: 0.97, duplicate: false);
        }

        if (str_starts_with($name, 'dupe_')) {
            return new ImageModerationResult(
                nsfwFlagged: false, nsfwScore: 0.02, duplicate: true,
                duplicateOfProviderId: 'stub-existing-provider',
                pHash: 'stub-phash-collision',
            );
        }

        return new ImageModerationResult(
            nsfwFlagged: false,
            nsfwScore: 0.02,
            duplicate: false,
            pHash: substr(hash('sha256', $name . microtime()), 0, 16),
        );
    }
}
