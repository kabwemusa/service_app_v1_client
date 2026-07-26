<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\LegalDocumentType;
use App\Http\Controllers\Controller;
use App\Models\ConsentRecord;
use App\Models\DataSubjectRequest;
use App\Models\LegalDocument;
use App\Services\AuditedMutationService;
use App\Services\Legal\LegalDocumentRepository;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Admin management of the legal-agreement layer — the UI that lets legal/compliance
 * edit the versioned documents WITHOUT a code change, and action data-subject
 * requests. Guarded by `legal.manage` (super_admin only).
 *
 * Immutability rule: a `published` version is never edited in place (users have
 * consented to that exact text). Edits happen on `draft` rows; going live is a
 * `publish` action that stamps the effective date and archives the prior published
 * version of that type. Every mutation is written through AuditedMutationService.
 */
class AdminLegalController extends Controller
{
    public function __construct(
        private readonly AuditedMutationService $audit,
        private readonly LegalDocumentRepository $docs,
    ) {}

    // ── Read ──────────────────────────────────────────────────────────────────

    /** GET /api/admin/legal/documents — every version grouped by type, + live consent counts. */
    public function index(): JsonResponse
    {
        $all = LegalDocument::orderBy('type')->orderByDesc('created_at')->get();

        $groups = collect(LegalDocumentType::required())->map(function (LegalDocumentType $type) use ($all) {
            $versions = $all->where('type', $type->value)->values();
            $current  = $this->docs->current($type);
            return [
                'type'            => $type->value,
                'label'           => $type->label(),
                'current_version' => $current?->version,
                'current_id'      => $current?->id,
                'versions'        => $versions->map(fn ($d) => $this->summary($d))->all(),
            ];
        });

        return ApiResponse::success([
            'draft_mode' => $this->docs->draftMode(),
            'groups'     => $groups,
        ]);
    }

    /** GET /api/admin/legal/documents/{id} — one version, full content. */
    public function show(string $id): JsonResponse
    {
        $doc = LegalDocument::findOrFail($id);
        return ApiResponse::success($this->detail($doc));
    }

    // ── Create / edit drafts ──────────────────────────────────────────────────

    /**
     * POST /api/admin/legal/documents — create a NEW draft version. Optionally
     * clones content from an existing version (`clone_from` id) as a starting point.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validatePayload($request, creating: true);

        // Prevent duplicate (type, version).
        $exists = LegalDocument::where('type', $data['type'])->where('version', $data['version'])->exists();
        if ($exists) {
            return ApiResponse::error('A version with that number already exists for this document.', 'DUPLICATE_VERSION', 422);
        }

        $doc = $this->audit->perform(
            actor: $request->user(),
            action: 'legal.document.create',
            targetType: 'legal_document',
            targetId: null,
            reason: (string) $request->input('reason'),
            metadata: ['after' => ['type' => $data['type'], 'version' => $data['version']]],
            mutation: fn () => LegalDocument::create([
                'id'             => (string) Str::uuid(),
                'type'           => $data['type'],
                'version'        => $data['version'],
                'status'         => 'draft', // always born as a draft
                'title'          => $data['title'],
                'summary'        => $data['summary'] ?? null,
                'content'        => $data['content'],
                'is_material'    => $data['is_material'] ?? true,
                'effective_date' => null,
            ]),
        );

        return ApiResponse::success($this->detail($doc), 'Draft version created.', 201);
    }

    /**
     * PATCH /api/admin/legal/documents/{id} — edit a DRAFT. Published/archived
     * versions are immutable (create a new version instead).
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $doc = LegalDocument::findOrFail($id);
        if ($doc->status !== 'draft') {
            return ApiResponse::error('Only draft versions can be edited. Create a new version to change published text.', 'IMMUTABLE_VERSION', 422);
        }

        $data = $this->validatePayload($request, creating: false);

        if (isset($data['version']) && $data['version'] !== $doc->version) {
            $clash = LegalDocument::where('type', $doc->type)->where('version', $data['version'])->where('id', '!=', $doc->id)->exists();
            if ($clash) {
                return ApiResponse::error('A version with that number already exists for this document.', 'DUPLICATE_VERSION', 422);
            }
        }

        $doc = $this->audit->perform(
            actor: $request->user(),
            action: 'legal.document.update',
            targetType: 'legal_document',
            targetId: $doc->id,
            reason: (string) $request->input('reason'),
            metadata: ['before' => ['version' => $doc->version, 'title' => $doc->title]],
            mutation: function () use ($doc, $data) {
                $doc->fill(array_filter([
                    'title'       => $data['title']   ?? null,
                    'summary'     => $data['summary'] ?? null,
                    'version'     => $data['version'] ?? null,
                    'content'     => $data['content'] ?? null,
                ], fn ($v) => $v !== null));
                if (array_key_exists('is_material', $data)) {
                    $doc->is_material = $data['is_material'];
                }
                $doc->save();
                return $doc;
            },
        );

        return ApiResponse::success($this->detail($doc), 'Draft updated.');
    }

    /**
     * POST /api/admin/legal/documents/{id}/publish — take a draft live. Stamps the
     * effective date and ARCHIVES the previously-published version of the same type
     * (there is only ever one live version per document). This is what triggers
     * re-consent for existing users on their next open.
     */
    public function publish(Request $request, string $id): JsonResponse
    {
        $doc = LegalDocument::findOrFail($id);
        if ($doc->status === 'published') {
            return ApiResponse::error('This version is already published.', 'ALREADY_PUBLISHED', 422);
        }
        if ($doc->status === 'archived') {
            return ApiResponse::error('Archived versions cannot be re-published; create a new version.', 'IMMUTABLE_VERSION', 422);
        }

        $validated = $request->validate([
            'effective_date' => ['sometimes', 'nullable', 'date'],
            'reason'         => ['required', 'string', 'min:10'],
        ]);
        $effective = $validated['effective_date'] ?? now()->toDateString();

        $doc = $this->audit->perform(
            actor: $request->user(),
            action: 'legal.document.publish',
            targetType: 'legal_document',
            targetId: $doc->id,
            reason: $validated['reason'],
            metadata: ['after' => ['type' => $doc->type, 'version' => $doc->version, 'effective_date' => $effective]],
            mutation: function () use ($doc, $effective) {
                // Archive the current live version of this type (if any).
                LegalDocument::where('type', $doc->type)
                    ->where('status', 'published')
                    ->where('id', '!=', $doc->id)
                    ->update(['status' => 'archived']);

                $doc->update(['status' => 'published', 'effective_date' => $effective]);
                return $doc;
            },
        );

        return ApiResponse::success($this->detail($doc), 'Version published.');
    }

    /** POST /api/admin/legal/documents/{id}/archive — retire a version. */
    public function archive(Request $request, string $id): JsonResponse
    {
        $doc = LegalDocument::findOrFail($id);
        $request->validate(['reason' => ['required', 'string', 'min:10']]);

        $doc = $this->audit->perform(
            actor: $request->user(),
            action: 'legal.document.archive',
            targetType: 'legal_document',
            targetId: $doc->id,
            reason: (string) $request->input('reason'),
            metadata: ['before' => ['status' => $doc->status]],
            mutation: function () use ($doc) {
                $doc->update(['status' => 'archived']);
                return $doc;
            },
        );

        return ApiResponse::success($this->detail($doc), 'Version archived.');
    }

    /** DELETE /api/admin/legal/documents/{id} — discard a DRAFT (never published text). */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $doc = LegalDocument::findOrFail($id);
        if ($doc->status !== 'draft') {
            return ApiResponse::error('Only draft versions can be deleted.', 'IMMUTABLE_VERSION', 422);
        }
        $request->validate(['reason' => ['required', 'string', 'min:10']]);

        $this->audit->perform(
            actor: $request->user(),
            action: 'legal.document.delete',
            targetType: 'legal_document',
            targetId: $doc->id,
            reason: (string) $request->input('reason'),
            metadata: ['before' => ['type' => $doc->type, 'version' => $doc->version]],
            mutation: function () use ($doc) {
                $doc->delete();
                return $doc;
            },
        );

        return ApiResponse::success(null, 'Draft deleted.');
    }

    // ── Data-subject requests queue ───────────────────────────────────────────

    /** GET /api/admin/legal/data-requests — the DSR queue (filter by status/type). */
    public function dataRequests(Request $request): JsonResponse
    {
        $q = DataSubjectRequest::query()
            ->join('users', 'users.id', '=', 'data_subject_requests.user_id')
            ->select('data_subject_requests.*', 'users.phone as user_phone')
            ->orderByDesc('data_subject_requests.created_at');

        if ($request->filled('status')) {
            $q->where('data_subject_requests.status', $request->string('status'));
        }
        if ($request->filled('type')) {
            $q->where('data_subject_requests.type', $request->string('type'));
        }

        $page = $q->paginate(30);

        return ApiResponse::success([
            'requests' => collect($page->items())->map(fn ($r) => [
                'id'         => $r->id,
                'user_id'    => $r->user_id,
                'user_phone' => $r->user_phone,
                'type'       => $r->type,
                'status'     => $r->status,
                'details'    => $r->details,
                'resolution_note' => $r->resolution_note,
                'created_at' => $r->created_at,
                'resolved_at'=> $r->resolved_at,
            ]),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }

    /** PATCH /api/admin/legal/data-requests/{id} — advance a DSR's status. */
    public function updateDataRequest(Request $request, string $id): JsonResponse
    {
        $req = DataSubjectRequest::findOrFail($id);
        $data = $request->validate([
            'status'          => ['required', 'in:RECEIVED,IN_PROGRESS,COMPLETED,REJECTED'],
            'resolution_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'reason'          => ['required', 'string', 'min:10'],
        ]);

        $req = $this->audit->perform(
            actor: $request->user(),
            action: 'legal.data_request.update',
            targetType: 'data_subject_request',
            targetId: $req->id,
            reason: $data['reason'],
            metadata: ['before' => ['status' => $req->status], 'after' => ['status' => $data['status']]],
            mutation: function () use ($req, $data) {
                $req->status = $data['status'];
                if (array_key_exists('resolution_note', $data)) {
                    $req->resolution_note = $data['resolution_note'];
                }
                if (in_array($data['status'], ['COMPLETED', 'REJECTED'], true)) {
                    $req->resolved_at = now();
                }
                $req->save();
                return $req;
            },
        );

        return ApiResponse::success([
            'id' => $req->id, 'status' => $req->status, 'resolved_at' => $req->resolved_at,
        ], 'Request updated.');
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function validatePayload(Request $request, bool $creating): array
    {
        $rules = [
            'title'                 => [$creating ? 'required' : 'sometimes', 'string', 'max:200'],
            'summary'               => ['sometimes', 'nullable', 'string', 'max:1000'],
            'version'               => [$creating ? 'required' : 'sometimes', 'string', 'max:40'],
            'is_material'           => ['sometimes', 'boolean'],
            'content'               => [$creating ? 'required' : 'sometimes', 'array'],
            'content.intro'         => ['sometimes', 'nullable', 'string'],
            'content.sections'      => [$creating ? 'required' : 'sometimes', 'array'],
            'content.sections.*.id'    => ['required_with:content.sections', 'string', 'max:80'],
            'content.sections.*.title' => ['required_with:content.sections', 'string', 'max:200'],
            'content.sections.*.level' => ['sometimes', 'integer', 'min:1', 'max:4'],
            'content.sections.*.body'  => ['required_with:content.sections', 'string'],
            'reason'                => ['required', 'string', 'min:10'],
        ];
        if ($creating) {
            $rules['type'] = ['required', 'in:terms_of_service,privacy_policy,user_agreement'];
        }

        $data = $request->validate($rules);

        // Normalise section defaults (level → 2) so the clients always get a shape.
        if (isset($data['content']['sections'])) {
            $data['content']['sections'] = array_map(function ($s) {
                return [
                    'id'    => $s['id'],
                    'title' => $s['title'],
                    'level' => $s['level'] ?? 2,
                    'body'  => $s['body'],
                ];
            }, $data['content']['sections']);
            $data['content']['intro'] = $data['content']['intro'] ?? '';
        }

        return $data;
    }

    private function summary(LegalDocument $d): array
    {
        return [
            'id'             => $d->id,
            'type'           => $d->type,
            'version'        => $d->version,
            'status'         => $d->status,
            'title'          => $d->title,
            'is_material'    => $d->is_material,
            'effective_date' => $d->effective_date?->toDateString(),
            'section_count'  => is_array($d->content['sections'] ?? null) ? count($d->content['sections']) : 0,
            'updated_at'     => $d->updated_at?->toIso8601String(),
        ];
    }

    private function detail(LegalDocument $d): array
    {
        return array_merge($this->summary($d), [
            'summary' => $d->summary,
            'content' => $d->content,
        ]);
    }
}
