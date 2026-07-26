<?php

namespace App\Http\Controllers\Api;

use App\Enums\LegalDocumentType;
use App\Http\Controllers\Controller;
use App\Services\Legal\LegalDocumentRepository;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * Public, read-anytime access to the versioned legal documents. The same source
 * feeds the consent gate, the in-app "Legal" screens and the PWA/website, so
 * every surface renders identical, versioned text (brief §D — accessible any time,
 * app + PWA parity).
 */
class LegalController extends Controller
{
    public function __construct(private readonly LegalDocumentRepository $docs) {}

    /** GET /api/legal/documents — metadata for the three current documents. */
    public function index(): JsonResponse
    {
        $items = $this->docs->currentRequired()->values()->map(fn ($d) => [
            'type'           => $d->type,
            'version'        => $d->version,
            'status'         => $d->status,
            'title'          => $d->title,
            'summary'        => $d->summary,
            'effective_date' => $d->effective_date?->toDateString(),
            'last_updated'   => $d->updated_at?->toDateString(),
        ])->all();

        return ApiResponse::success([
            'draft_mode' => $this->docs->draftMode(),
            'documents'  => $items,
        ]);
    }

    /** GET /api/legal/documents/{type} — full current content for one document. */
    public function show(string $type): JsonResponse
    {
        $enum = LegalDocumentType::tryFrom($type);
        if (! $enum) {
            return ApiResponse::error('Unknown legal document.', 'UNKNOWN_DOCUMENT', 404);
        }

        $doc = $this->docs->current($enum);
        if (! $doc) {
            return ApiResponse::error('This document is not available yet.', 'DOCUMENT_UNAVAILABLE', 404);
        }

        return ApiResponse::success([
            'type'           => $doc->type,
            'version'        => $doc->version,
            'status'         => $doc->status,
            'title'          => $doc->title,
            'summary'        => $doc->summary,
            'effective_date' => $doc->effective_date?->toDateString(),
            'last_updated'   => $doc->updated_at?->toDateString(),
            'draft_mode'     => $this->docs->draftMode(),
            'content'        => $doc->content, // { intro, sections: [{ id, title, level, body }] }
        ]);
    }
}
