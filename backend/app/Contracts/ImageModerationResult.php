<?php

namespace App\Contracts;

/**
 * Outcome of the §5.3 image pipeline for a single portfolio image. Shapes the
 * `nsfw` / `phash_duplicate` automated-check fields the admin panel renders.
 */
final class ImageModerationResult
{
    public function __construct(
        public readonly bool    $nsfwFlagged,
        public readonly float   $nsfwScore,
        public readonly bool    $duplicate,
        public readonly ?string $duplicateOfProviderId = null,
        /** Perceptual hash, persisted so future submissions can be compared. */
        public readonly ?string $pHash = null,
    ) {}

    /** A hard fail the submission flow should reject before it reaches a reviewer. */
    public function rejected(): bool
    {
        return $this->nsfwFlagged || $this->duplicate;
    }

    public function reason(): ?string
    {
        if ($this->nsfwFlagged) {
            return 'This image was flagged as inappropriate. Please choose another.';
        }
        if ($this->duplicate) {
            return 'This image already appears on another profile. Please use your own work.';
        }
        return null;
    }
}
