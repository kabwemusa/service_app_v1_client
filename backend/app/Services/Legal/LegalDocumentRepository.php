<?php

namespace App\Services\Legal;

use App\Enums\LegalDocumentType;
use App\Models\LegalDocument;
use Illuminate\Support\Collection;

/**
 * Resolves the CURRENT version of each legal document from the versioned content
 * source (legal_documents). "Current" = the latest published row; in non-production
 * with config('legal.draft_mode') on, the latest draft is used so the scaffold is
 * reviewable before publication.
 *
 * This is the single place both the API and the consent logic agree on what the
 * required versions are — so the gate, the audit and the rendered document never
 * drift apart.
 */
class LegalDocumentRepository
{
    public function draftMode(): bool
    {
        return (bool) config('legal.draft_mode', false);
    }

    /** The current document for a type, or null if none exists yet. */
    public function current(LegalDocumentType $type): ?LegalDocument
    {
        $query = LegalDocument::where('type', $type->value);

        if ($this->draftMode()) {
            // Prefer a published version; fall back to the latest draft.
            $published = (clone $query)->where('status', 'published')
                ->orderByDesc('effective_date')->orderByDesc('created_at')->first();
            if ($published) {
                return $published;
            }
            return (clone $query)->whereIn('status', ['draft', 'published'])
                ->orderByDesc('created_at')->first();
        }

        return $query->where('status', 'published')
            ->orderByDesc('effective_date')->orderByDesc('created_at')->first();
    }

    /** The current version string for a type, or null. */
    public function currentVersion(LegalDocumentType $type): ?string
    {
        return $this->current($type)?->version;
    }

    /** All three current required documents, keyed by type value. */
    public function currentRequired(): Collection
    {
        return collect(LegalDocumentType::required())
            ->mapWithKeys(fn (LegalDocumentType $t) => [$t->value => $this->current($t)])
            ->filter();
    }
}
