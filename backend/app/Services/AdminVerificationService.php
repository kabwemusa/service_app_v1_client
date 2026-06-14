<?php

namespace App\Services;

use App\Enums\DocStatus;
use App\Enums\DocType;
use App\Enums\ErrorCode;
use App\Enums\TrustTier;
use App\Exceptions\Api\ApiException;
use App\Models\AdminUser;
use App\Models\IdentityDocument;
use App\Models\ProviderProfile;
use App\Models\User;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\URL;

/**
 * Backend for the admin Verification queue (UI: admin/src/components/verification).
 *
 * Maps `identity_documents` (+ provider tier fields) into the submission shapes
 * the panel consumes, and runs reviewer decisions through AuditedMutationService
 * so every approve/reject/request-info writes an audit entry in one transaction.
 *
 * PRIVACY: KYC artifacts (ID/selfie) are streamed only via short-lived signed
 * URLs issued here to capability-holding reviewers; their paths/URLs are never
 * written to audit metadata, and the selfie is never exposed as a public avatar.
 */
class AdminVerificationService
{
    private const SLA_HOURS          = 24;   // §4.3 manual-review SLA
    private const SLA_DUE_SOON_HOURS = 6;
    private const ARTIFACT_URL_TTL_MIN = 10;

    /** doc_types that represent a reviewable submission (SELFIE is a sub-artifact). */
    private const QUEUE_DOC_TYPES = [
        'NRC', 'PASSPORT', 'DRIVERS_LICENSE', 'PROOF_OF_ADDRESS', 'CERTIFICATE',
    ];

    public function __construct(private readonly AuditedMutationService $audit) {}

    // ── List ─────────────────────────────────────────────────────────────────

    public function list(array $filters): array
    {
        $query = IdentityDocument::query()
            ->with(['user.providerProfile', 'claimedByAdmin'])
            ->whereIn('doc_type', self::QUEUE_DOC_TYPES);

        // type → underlying doc_types
        if (!empty($filters['type'])) {
            $query->whereIn('doc_type', $this->docTypesForSubmissionType($filters['type']));
        }

        // status → underlying conditions
        if (!empty($filters['status'])) {
            $this->applyStatusFilter($query, $filters['status']);
        }

        // sla
        if (($filters['sla'] ?? '') === 'breached') {
            $query->whereNotIn('status', [DocStatus::APPROVED->value, DocStatus::AUTO_APPROVED->value, DocStatus::REJECTED->value, DocStatus::AUTO_REJECTED->value])
                  ->where('submitted_at', '<', now()->subHours(self::SLA_HOURS));
        } elseif (($filters['sla'] ?? '') === 'due_soon') {
            $query->whereNotIn('status', [DocStatus::APPROVED->value, DocStatus::AUTO_APPROVED->value, DocStatus::REJECTED->value, DocStatus::AUTO_REJECTED->value])
                  ->whereBetween('submitted_at', [
                      now()->subHours(self::SLA_HOURS),
                      now()->subHours(self::SLA_HOURS - self::SLA_DUE_SOON_HOURS),
                  ]);
        }

        // search by applicant name
        if (!empty($filters['search'])) {
            $term = '%' . $filters['search'] . '%';
            $query->whereHas('user', function ($u) use ($term) {
                $u->where('legal_name', 'ilike', $term)
                  ->orWhereHas('providerProfile', fn ($p) => $p->where('display_name', 'ilike', $term));
            });
        }

        // Oldest-pending first: unresolved before resolved, then oldest submitted.
        $resolved = [DocStatus::APPROVED->value, DocStatus::AUTO_APPROVED->value, DocStatus::REJECTED->value, DocStatus::AUTO_REJECTED->value];
        $query->orderByRaw('CASE WHEN status IN (?, ?, ?, ?) THEN 1 ELSE 0 END ASC', $resolved)
              ->orderBy('submitted_at', ($filters['sort'] ?? 'oldest') === 'newest' ? 'desc' : 'asc');

        /** @var LengthAwarePaginator $page */
        $page = $query->paginate(20, ['*'], 'page', (int) ($filters['page'] ?? 1));

        return [
            'data' => collect($page->items())->map(fn (IdentityDocument $d) => $this->presentSummary($d))->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page'    => $page->lastPage(),
                'per_page'     => $page->perPage(),
                'total'        => $page->total(),
            ],
        ];
    }

    // ── Detail ───────────────────────────────────────────────────────────────

    public function detail(IdentityDocument $doc): array
    {
        $doc->loadMissing(['user.providerProfile', 'claimedByAdmin', 'reviewerAdmin']);
        $user    = $doc->user;
        $profile = $user?->providerProfile;

        $priorReviews = IdentityDocument::where('user_id', $doc->user_id)
            ->whereKeyNot($doc->id)->whereNotNull('reviewed_at')->count();
        $priorRejections = IdentityDocument::where('user_id', $doc->user_id)
            ->whereKeyNot($doc->id)
            ->whereIn('status', [DocStatus::REJECTED->value, DocStatus::AUTO_REJECTED->value])
            ->count();

        $summary = $this->presentSummary($doc);

        return array_merge($summary, [
            'applicant' => array_merge($summary['applicant'], [
                // Reviewer-only fields — never leave the admin surface.
                'legal_name'      => $user?->legal_name,
                'trust_score'     => $profile ? (float) $profile->trust_score : null,
                'prior_reviews'   => $priorReviews,
                'prior_rejections'=> $priorRejections,
            ]),
            'artifacts'     => $this->buildArtifacts($doc),
            'automated'     => $this->buildAutomatedChecks($doc, $user),
            'tier4'         => null, // No Tier-4 skill-proof capture flow yet (§4.5) — null until one exists.
            'certification' => $this->buildCertification($doc),
            'timeline'      => array_values($doc->timeline ?? []),
        ]);
    }

    // ── Claim / assignment (not audited — assignment, not a state decision) ────

    public function claim(IdentityDocument $doc, AdminUser $actor): array
    {
        $this->assertNotResolved($doc);

        if ($doc->claimed_by_admin_id && $doc->claimed_by_admin_id !== $actor->id) {
            throw new ApiException(ErrorCode::CONFLICT, 'Already claimed by another reviewer.');
        }

        $doc->update(['claimed_by_admin_id' => $actor->id, 'claimed_at' => now()]);
        $doc->pushEvent('Claimed for review', $actor->name, null, $doc->status, true);

        return $this->detail($doc->fresh());
    }

    public function release(IdentityDocument $doc, AdminUser $actor): array
    {
        if ($doc->claimed_by_admin_id === $actor->id) {
            $doc->update(['claimed_by_admin_id' => null, 'claimed_at' => null]);
        }

        return $this->detail($doc->fresh());
    }

    // ── Decisions (audited) ──────────────────────────────────────────────────

    public function approve(IdentityDocument $doc, AdminUser $actor, string $reason): array
    {
        $this->assertActionable($doc, $actor);

        $before = ['status' => $doc->status, 'trust_tier' => $doc->user?->providerProfile?->trust_tier ?? 0];

        $this->audit->perform(
            actor: $actor,
            action: 'verification.approve',
            targetType: 'verification_submission',
            targetId: $doc->id,
            reason: $reason,
            metadata: ['before' => $before], // PII-free; 'after' added below
            mutation: function () use ($doc, $actor, $reason) {
                $doc->update([
                    'status'            => DocStatus::APPROVED->value,
                    'reviewer_admin_id' => $actor->id,
                    'review_notes'      => null,
                    'reviewed_at'       => now(),
                    'info_requested_at' => null,
                ]);
                $this->grantTierFor($doc);
                $doc->pushEvent('Approved', $actor->name, $reason, DocStatus::APPROVED->value, true);
            },
        );

        return $this->detail($doc->fresh());
    }

    public function reject(IdentityDocument $doc, AdminUser $actor, string $reason): array
    {
        $this->assertActionable($doc, $actor);

        $this->audit->perform(
            actor: $actor,
            action: 'verification.reject',
            targetType: 'verification_submission',
            targetId: $doc->id,
            reason: $reason,
            metadata: ['before' => ['status' => $doc->status]],
            mutation: function () use ($doc, $actor, $reason) {
                $doc->update([
                    'status'            => DocStatus::REJECTED->value,
                    'reviewer_admin_id' => $actor->id,
                    'review_notes'      => $reason, // shown to the applicant
                    'reviewed_at'       => now(),
                    'info_requested_at' => null,
                ]);
                $doc->pushEvent('Rejected', $actor->name, $reason, DocStatus::REJECTED->value, true);
            },
        );

        return $this->detail($doc->fresh());
    }

    public function requestInfo(IdentityDocument $doc, AdminUser $actor, string $reason): array
    {
        $this->assertActionable($doc, $actor);

        $this->audit->perform(
            actor: $actor,
            action: 'verification.request_info',
            targetType: 'verification_submission',
            targetId: $doc->id,
            reason: $reason,
            metadata: ['before' => ['status' => $doc->status]],
            mutation: function () use ($doc, $actor, $reason) {
                $doc->update([
                    'status'            => DocStatus::MANUAL_REVIEW->value,
                    'reviewer_admin_id' => $actor->id,
                    'review_notes'      => $reason, // note shown to the applicant
                    'info_requested_at' => now(),
                ]);
                $doc->pushEvent('More information requested', $actor->name, $reason, DocStatus::MANUAL_REVIEW->value, true);
            },
        );

        return $this->detail($doc->fresh());
    }

    // ── Artifact streaming (signed, reviewer-only) ───────────────────────────

    public function artifactPath(IdentityDocument $doc, string $kind): ?string
    {
        return match ($kind) {
            'doc'    => $doc->doc_storage_url,
            'selfie' => $doc->extracted_fields['selfie_path'] ?? null,
            default  => null,
        };
    }

    // ── Presenters ───────────────────────────────────────────────────────────

    private function presentSummary(IdentityDocument $doc): array
    {
        $user    = $doc->user;
        $profile = $user?->providerProfile;

        return [
            'id'           => $doc->id,
            'type'         => $this->submissionType($doc->doc_type),
            'status'       => $this->verificationStatus($doc),
            'submitted_at' => optional($doc->submitted_at)->toIso8601String(),
            'auto_summary' => $this->autoSummary($doc),
            'sla_due_at'   => $this->slaDueAt($doc),
            'claimed_by'   => $doc->claimedByAdmin
                ? ['id' => $doc->claimedByAdmin->id, 'name' => $doc->claimedByAdmin->name]
                : null,
            'applicant'    => [
                'id'            => (string) $doc->user_id,
                'display_name'  => $profile?->display_name ?? $user?->legal_name ?? 'Provider',
                'account_state' => $user?->account_state ?? 'ACTIVE',
                'current_tier'  => (int) ($profile?->trust_tier ?? 0),
            ],
            'decision'     => $this->buildDecision($doc),
        ];
    }

    private function buildDecision(IdentityDocument $doc): ?array
    {
        $status = DocStatus::from($doc->status);
        if (!$status->isPassed() && !$status->isFailed()) {
            return null;
        }

        return [
            'outcome'    => $status->isPassed() ? 'approved' : 'rejected',
            'reason'     => $doc->review_notes ?? '',
            'decided_by' => $doc->reviewerAdmin?->name ?? 'Automated pipeline',
            'decided_at' => optional($doc->reviewed_at)->toIso8601String(),
        ];
    }

    private function buildArtifacts(IdentityDocument $doc): array
    {
        $artifacts = [];

        $docKind = match (DocType::from($doc->doc_type)) {
            DocType::PROOF_OF_ADDRESS => 'proof_of_address',
            DocType::CERTIFICATE      => 'certificate',
            default                   => 'id_document',
        };

        if ($doc->doc_storage_url) {
            $artifacts[] = [
                'id'       => $doc->id . ':doc',
                'kind'     => $docKind,
                'url'      => $this->signedArtifactUrl($doc, 'doc'),
                'label'    => $this->docTypeLabel($doc->doc_type),
                'doc_type' => $doc->doc_type,
            ];
        }

        if (!empty($doc->extracted_fields['selfie_path'])) {
            $artifacts[] = [
                'id'    => $doc->id . ':selfie',
                'kind'  => 'selfie',
                'url'   => $this->signedArtifactUrl($doc, 'selfie'),
                'label' => 'Liveness selfie',
            ];
        }

        return $artifacts;
    }

    private function signedArtifactUrl(IdentityDocument $doc, string $kind): string
    {
        return URL::temporarySignedRoute(
            'admin.verifications.artifact',
            now()->addMinutes(self::ARTIFACT_URL_TTL_MIN),
            ['document' => $doc->id, 'kind' => $kind],
        );
    }

    private function buildAutomatedChecks(IdentityDocument $doc, ?User $user): array
    {
        $fields = $doc->extracted_fields ?? [];
        $checks = [];

        if ($doc->confidence_score !== null) {
            $checks['authenticity'] = [
                'score' => (float) $doc->confidence_score,
                'flags' => array_values((array) ($fields['flags'] ?? [])),
            ];
        }

        if (!empty($fields['name']) && $user?->legal_name) {
            $distance = levenshtein(
                strtolower(trim($fields['name'])),
                strtolower(trim($user->legal_name)),
            );
            $checks['name_consistency'] = [
                'matched'  => $distance <= 2,
                'distance' => $distance,
            ];
        }

        return $checks;
    }

    private function buildCertification(IdentityDocument $doc): ?array
    {
        if (DocType::from($doc->doc_type) !== DocType::CERTIFICATE) {
            return null;
        }

        $f = $doc->extracted_fields ?? [];

        return [
            'cert_type'  => $f['cert_type'] ?? 'TRADE_CERT',
            'title'      => $f['title'] ?? 'Certificate',
            'issuer'     => $f['issuer'] ?? '—',
            'issued_on'  => $f['issued_on'] ?? null,
            'expires_on' => optional($doc->expires_on)->toDateString(),
        ];
    }

    // ── Status / type mapping ────────────────────────────────────────────────

    private function submissionType(string $docType): string
    {
        return match (DocType::from($docType)) {
            DocType::PROOF_OF_ADDRESS => 'TIER3_ADDRESS',
            DocType::CERTIFICATE      => 'CERTIFICATION',
            default                   => 'TIER2_IDENTITY',
        };
    }

    private function docTypesForSubmissionType(string $type): array
    {
        return match ($type) {
            'TIER3_ADDRESS' => ['PROOF_OF_ADDRESS'],
            'CERTIFICATION' => ['CERTIFICATE'],
            'TIER4_SKILL'   => ['__none__'], // no capture flow yet
            default         => ['NRC', 'PASSPORT', 'DRIVERS_LICENSE'],
        };
    }

    private function verificationStatus(IdentityDocument $doc): string
    {
        $status = DocStatus::from($doc->status);

        if ($status->isPassed()) return 'approved';
        if ($status->isFailed()) return 'rejected';
        if ($doc->info_requested_at) return 'needs_info';
        if ($status === DocStatus::EXPIRED) return 'needs_info';
        if ($doc->claimed_by_admin_id) return 'in_review';

        return 'pending';
    }

    private function applyStatusFilter($query, string $status): void
    {
        match ($status) {
            'approved'  => $query->whereIn('status', [DocStatus::APPROVED->value, DocStatus::AUTO_APPROVED->value]),
            'rejected'  => $query->whereIn('status', [DocStatus::REJECTED->value, DocStatus::AUTO_REJECTED->value]),
            'needs_info'=> $query->whereNotNull('info_requested_at')
                                 ->whereIn('status', [DocStatus::SUBMITTED->value, DocStatus::MANUAL_REVIEW->value, DocStatus::EXPIRED->value]),
            'in_review' => $query->whereNull('info_requested_at')->whereNotNull('claimed_by_admin_id')
                                 ->whereIn('status', [DocStatus::SUBMITTED->value, DocStatus::MANUAL_REVIEW->value]),
            'pending'   => $query->whereNull('info_requested_at')->whereNull('claimed_by_admin_id')
                                 ->whereIn('status', [DocStatus::SUBMITTED->value, DocStatus::MANUAL_REVIEW->value]),
            default     => null,
        };
    }

    private function autoSummary(IdentityDocument $doc): string
    {
        if ($doc->confidence_score !== null) {
            $flags = (array) ($doc->extracted_fields['flags'] ?? []);
            $flagPart = count($flags) > 0 ? count($flags) . ' flag(s)' : 'no flags';
            return 'Confidence ' . number_format((float) $doc->confidence_score, 2) . ' · ' . $flagPart;
        }

        return DocStatus::from($doc->status) === DocStatus::SUBMITTED
            ? 'Awaiting automated checks'
            : '—';
    }

    private function slaDueAt(IdentityDocument $doc): ?string
    {
        $status = DocStatus::from($doc->status);
        if ($status->isPassed() || $status->isFailed() || !$doc->submitted_at) {
            return null;
        }

        return $doc->submitted_at->copy()->addHours(self::SLA_HOURS)->toIso8601String();
    }

    private function docTypeLabel(string $docType): string
    {
        return match (DocType::from($docType)) {
            DocType::NRC              => 'National Registration Card',
            DocType::PASSPORT         => 'Passport',
            DocType::DRIVERS_LICENSE  => "Driver's License",
            DocType::PROOF_OF_ADDRESS => 'Proof of address',
            DocType::CERTIFICATE      => 'Certificate',
            DocType::SELFIE           => 'Selfie',
        };
    }

    // ── Decision helpers ─────────────────────────────────────────────────────

    private function grantTierFor(IdentityDocument $doc): void
    {
        $target = match (DocType::from($doc->doc_type)) {
            DocType::NRC, DocType::PASSPORT, DocType::DRIVERS_LICENSE => TrustTier::IDENTIFIED,
            DocType::PROOF_OF_ADDRESS                                 => TrustTier::VERIFIED,
            default                                                   => null, // CERTIFICATE attaches, no tier change
        };
        if (!$target) {
            return;
        }

        $profile = ProviderProfile::where('user_id', $doc->user_id)->first();
        if ($profile && $profile->trust_tier < $target->value) {
            $profile->update(['trust_tier' => $target->value, 'kyc_status' => 'VERIFIED']);
        }
    }

    private function assertNotResolved(IdentityDocument $doc): void
    {
        $status = DocStatus::from($doc->status);
        if ($status->isPassed() || $status->isFailed()) {
            throw new ApiException(ErrorCode::CONFLICT, 'This submission is already resolved.');
        }
    }

    private function assertActionable(IdentityDocument $doc, AdminUser $actor): void
    {
        $this->assertNotResolved($doc);

        if ($doc->claimed_by_admin_id !== $actor->id) {
            throw new ApiException(
                ErrorCode::FORBIDDEN,
                'Claim this submission before acting on it (it may be claimed by another reviewer).',
            );
        }
    }
}
