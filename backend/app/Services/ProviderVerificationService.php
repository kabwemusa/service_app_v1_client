<?php

namespace App\Services;

use App\Contracts\ImageModerationProvider;
use App\Contracts\TrustEngine;
use App\Enums\DocStatus;
use App\Enums\DocType;
use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Models\Booking;
use App\Models\IdentityDocument;
use App\Models\ProviderProfile;
use App\Models\ProviderService;
use App\Models\ProviderVerification;
use App\Models\Review;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Provider-facing tier-upgrade / clearance flow (the "upgrade later" surface
 * onboarding handed off to).
 *
 * LOAD-BEARING RULE: this submits evidence and MIRRORS server eligibility — it
 * never grants it. Dispatchability is decided by ProviderVerification rows +
 * RealTrustEngine::checkEligibility. A submission only enters the existing admin
 * Verification queue (as a CERTIFICATE IdentityDocument); the eligibility flip
 * happens when an admin APPROVES it (AdminVerificationService).
 */
class ProviderVerificationService
{
    private const MIN_PORTFOLIO_IMAGES = 3;
    private const MAX_PORTFOLIO_IMAGES = 8;

    // §4.5 Tier-4 (Professional) is EARNED, not uploaded.
    private const TIER4_REQUIRED_JOBS   = 20;
    private const TIER4_REQUIRED_RATING = 4.5;

    public function __construct(
        private readonly ImageModerationProvider $images,
        private readonly TrustEngine             $trust,
    ) {}

    // ── Status home (the ladder, mirroring server eligibility) ───────────────

    public function status(User $user): array
    {
        $profile = ProviderProfile::where('user_id', $user->id)->first();
        $tier    = (int) ($profile?->trust_tier ?? 0);

        $verified = ProviderVerification::where('provider_id', $user->id)
            ->where('status', 'VERIFIED')
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->pluck('verification_type')->all();

        $tiers = [
            $this->baseTierRow($verified),
            $this->uploadTierRow($user, 2, 'portfolio', 'PORTFOLIO_ITEM', 'Public-venue jobs (salon, studio)', 'Add a portfolio of your work', $verified),
            $this->uploadTierRow($user, 3, 'police_clearance', 'POLICE_CLEARANCE', 'In-home jobs (work at a customer’s home)', 'Add a police clearance certificate', $verified),
            $this->tier4Row($user),
        ];

        $pendingReview = collect($tiers)->contains(fn ($t) => ($t['state'] ?? null) === 'UNDER_REVIEW');

        return [
            'current_tier'   => $tier,
            'tiers'          => $tiers,
            'pending_review' => $pendingReview,
            // Listings that exist but are non-dispatchable until a tier is confirmed.
            'pending_listings' => $this->pendingListings($user),
        ];
    }

    // ── Submissions (enter the existing admin queue) ─────────────────────────

    /**
     * Tier 3 — police clearance. Single in-flight submission per tier. Lands in
     * the admin queue as a CERTIFICATE (cert_type POLICE_CLEARANCE); the eligibility
     * flip is on admin approval, not here.
     */
    public function submitPoliceClearance(
        User $user, UploadedFile $document, string $certNumber, string $issuedOn, ?string $expiresOn = null,
    ): IdentityDocument {
        $this->requireProvider($user);
        $this->assertNoInFlight($user, 'POLICE_CLEARANCE', 'police_clearance');

        $path = $document->store("kyc/{$user->id}/clearance", 'local');

        $doc = new IdentityDocument([
            'user_id'         => $user->id,
            'doc_type'        => DocType::CERTIFICATE->value,
            'doc_storage_url' => $path,
            'status'          => DocStatus::SUBMITTED->value,
            'submitted_at'    => now(),
            'expires_on'      => $expiresOn,
            'extracted_fields'=> [
                'cert_type'   => 'POLICE_CLEARANCE',
                'title'       => 'Police clearance certificate',
                'issuer'      => 'Zambia Police Service',
                'cert_number' => $certNumber,
                'issued_on'   => $issuedOn,
            ],
        ]);
        $doc->pushEvent('Submitted by applicant', 'Applicant', null, DocStatus::SUBMITTED->value);
        $doc->save();

        return $doc;
    }

    /**
     * Tier 2 — portfolio. Each image runs the §5.3 pipeline (NSFW / pHash-dup);
     * a hard fail is rejected before it ever reaches a reviewer. Accepted images
     * land in the admin queue as portfolio_item artifacts.
     */
    public function submitPortfolio(User $user, array $files): IdentityDocument
    {
        $this->requireProvider($user);
        $this->assertNoInFlight($user, 'PORTFOLIO_ITEM', 'portfolio');

        $files = array_values(array_filter($files));
        if (count($files) < self::MIN_PORTFOLIO_IMAGES) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Add at least ' . self::MIN_PORTFOLIO_IMAGES . ' photos of your work.');
        }
        if (count($files) > self::MAX_PORTFOLIO_IMAGES) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'You can submit up to ' . self::MAX_PORTFOLIO_IMAGES . ' photos.');
        }

        $paths  = [];
        $checks = ['nsfw' => ['flagged' => false], 'phash_duplicate' => ['flagged' => false]];

        foreach ($files as $file) {
            /** @var UploadedFile $file */
            $result = $this->images->inspect($file);
            if ($result->rejected()) {
                // Don't persist a flagged image; surface the pipeline reason.
                throw new ApiException(ErrorCode::VALIDATION_ERROR, $result->reason() ?? 'An image failed our checks.');
            }
            // NOTE: EXIF strip happens here in production (re-encode); the stub is a no-op.
            $paths[] = $file->store("kyc/{$user->id}/portfolio", 'local');
            if ($result->nsfwScore > ($checks['nsfw']['score'] ?? 0)) {
                $checks['nsfw']['score'] = $result->nsfwScore;
            }
        }

        $doc = new IdentityDocument([
            'user_id'         => $user->id,
            'doc_type'        => DocType::CERTIFICATE->value,
            'doc_storage_url' => $paths[0],
            'status'          => DocStatus::SUBMITTED->value,
            'submitted_at'    => now(),
            'extracted_fields'=> [
                'cert_type'       => 'PORTFOLIO_ITEM',
                'title'           => 'Portfolio',
                'portfolio_paths' => $paths,
                'nsfw'            => $checks['nsfw'],
                'phash_duplicate' => $checks['phash_duplicate'],
            ],
        ]);
        $doc->pushEvent('Submitted by applicant', 'Applicant', null, DocStatus::SUBMITTED->value);
        $doc->save();

        return $doc;
    }

    // ── Ladder rows ──────────────────────────────────────────────────────────

    private function baseTierRow(array $verified): array
    {
        $done = in_array('nrc', $verified, true) && in_array('momo_name_match', $verified, true);

        return [
            'tier'        => 1,
            'label'       => 'Identified',
            'unlocks'     => 'Remote & digital jobs',
            'requirement' => 'NRC + Mobile Money match',
            'kind'        => 'base',
            'state'       => $done ? 'DONE' : 'ADD',
        ];
    }

    private function uploadTierRow(
        User $user, int $tier, string $verificationType, string $certType, string $unlocks, string $requirement, array $verified,
    ): array {
        $row = [
            'tier'        => $tier,
            'label'       => $tier === 2 ? 'Trusted' : 'In-home cleared',
            'unlocks'     => $unlocks,
            'requirement' => $requirement,
            'kind'        => 'upload',
            'verification_type' => $verificationType,
        ];

        if (in_array($verificationType, $verified, true)) {
            $expiry = ProviderVerification::where('provider_id', $user->id)
                ->where('verification_type', $verificationType)->value('expires_at');
            return $row + ['state' => 'DONE', 'expires_at' => optional($expiry)->toIso8601String()];
        }

        // Latest submission of this cert_type drives the live state.
        $doc = $this->latestSubmission($user->id, $certType);
        if ($doc) {
            $status = DocStatus::from($doc->status);
            if ($doc->info_requested_at || $status->isFailed()) {
                return $row + ['state' => 'NEEDS_CHANGES', 'reason' => $doc->review_notes, 'submission_id' => $doc->id];
            }
            if ($status->isPending()) {
                return $row + ['state' => 'UNDER_REVIEW', 'submission_id' => $doc->id, 'submitted_at' => optional($doc->submitted_at)->toIso8601String()];
            }
        }

        return $row + ['state' => 'ADD'];
    }

    /** §4.5 Tier 4 is EARNED (jobs + rating + clean disputes) — progress, not an upload. */
    private function tier4Row(User $user): array
    {
        $completed = Booking::where('provider_id', $user->id)->whereIn('status', ['COMPLETED', 'DISBURSED'])->count();
        $avg       = (float) Review::where('reviewee_id', $user->id)->avg('rating');
        $disputes  = Booking::where('provider_id', $user->id)->where('status', 'DISPUTED')->count();

        $jobsMet     = $completed >= self::TIER4_REQUIRED_JOBS;
        $ratingMet   = $avg >= self::TIER4_REQUIRED_RATING;
        $disputesMet = $disputes === 0;

        return [
            'tier'     => 4,
            'label'    => 'Professional',
            'unlocks'  => 'Promoted placement & higher caps',
            'kind'     => 'earned',
            'state'    => ($jobsMet && $ratingMet && $disputesMet) ? 'EARNED' : 'EARNED_PROGRESS',
            'progress' => [
                'completed_jobs'  => $completed,
                'required_jobs'   => self::TIER4_REQUIRED_JOBS,
                'avg_rating'      => $avg > 0 ? round($avg, 2) : null,
                'required_rating' => self::TIER4_REQUIRED_RATING,
                'upheld_disputes' => $disputes,
                'jobs_met'        => $jobsMet,
                'rating_met'      => $ratingMet,
                'disputes_met'    => $disputesMet,
            ],
        ];
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Services the provider has listed that the gate currently blocks (pending a tier). */
    private function pendingListings(User $user): array
    {
        return ProviderService::with('service.category')
            ->where('provider_id', $user->id)
            ->where('status', 'ACTIVE')
            ->get()
            ->map(fn (ProviderService $ps) => [
                'service_id'  => $ps->service_id,
                'title'       => $ps->service?->title,
                'eligibility' => $this->trust->checkEligibility($user->id, $ps->service_id),
            ])
            ->filter(fn ($row) => ! ($row['eligibility']['eligible'] ?? true))
            ->values()->all();
    }

    private function latestSubmission(string $userId, string $certType): ?IdentityDocument
    {
        return IdentityDocument::where('user_id', $userId)
            ->where('doc_type', DocType::CERTIFICATE->value)
            ->where('extracted_fields->cert_type', $certType)
            ->latest('submitted_at')
            ->first();
    }

    /** Enforce a single in-flight submission per tier (no double-queueing). */
    private function assertNoInFlight(User $user, string $certType, string $verificationType): void
    {
        $alreadyVerified = ProviderVerification::where('provider_id', $user->id)
            ->where('verification_type', $verificationType)
            ->where('status', 'VERIFIED')
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->exists();
        if ($alreadyVerified) {
            throw new ApiException(ErrorCode::CONFLICT, 'This verification is already complete.');
        }

        $doc = $this->latestSubmission($user->id, $certType);
        if ($doc && DocStatus::from($doc->status)->isPending() && ! $doc->info_requested_at) {
            throw new ApiException(ErrorCode::CONFLICT, 'You already have a submission under review. We’ll let you know the outcome.');
        }
    }

    private function requireProvider(User $user): void
    {
        if (! ProviderProfile::where('user_id', $user->id)->exists()) {
            throw new ApiException(ErrorCode::FORBIDDEN, 'Complete your provider setup first.');
        }
    }
}
