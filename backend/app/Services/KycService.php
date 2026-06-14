<?php

namespace App\Services;

use App\Contracts\IdentityVerificationProviderInterface;
use App\Contracts\WalletNameLookupInterface;
use App\Enums\DocStatus;
use App\Enums\DocType;
use App\Enums\ErrorCode;
use App\Enums\TrustTier;
use App\Exceptions\Api\ApiException;
use App\Models\FraudDenylist;
use App\Models\IdentityDocument;
use App\Models\ProviderProfile;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * KYC verification pipeline — §4.3 of the v3 spec.
 *
 * Tier 1 — selfie + legal name (no document scan needed).
 * Tier 2 — government ID scan + liveness match.
 * Tier 3 — proof of address (OCR date/name check).
 */
class KycService
{
    private const FACE_MATCH_THRESHOLD  = 0.85;
    private const MIN_CONFIDENCE        = 0.80;
    private const DOC_NUMBER_PEPPER_ENV = 'KYC_HASH_PEPPER';

    public function __construct(
        private readonly IdentityVerificationProviderInterface $verifier,
        private readonly WalletNameLookupInterface             $walletNames,
    ) {}

    // ── Tier 1: contact + selfie ─────────────────────────────────────────────

    /**
     * Finalise Tier 1: provider submits legal name + selfie.
     * No document scan — just contact verification.
     */
    public function submitTier1(User $user, string $legalName, UploadedFile $selfie): IdentityDocument
    {
        $profile = $this->requireProviderProfile($user);

        // Store selfie
        $selfiePath = $selfie->store("kyc/{$user->id}/selfies", 'local');

        $doc = IdentityDocument::create([
            'user_id'          => $user->id,
            'doc_type'         => DocType::SELFIE->value,
            'doc_storage_url'  => $selfiePath,
            'status'           => DocStatus::AUTO_APPROVED->value,
            'confidence_score' => 1.00,
            'submitted_at'     => now(),
            'reviewed_at'      => now(),
        ]);

        // Update user legal name + bump tier to 1
        $user->update(['legal_name' => $legalName]);
        $this->bumpTier($user, $profile, TrustTier::BASIC);

        return $doc;
    }

    // ── Tier 2: government ID pipeline ──────────────────────────────────────

    /**
     * Submit a government ID document for automated verification.
     * Dispatches VerifyIdentityDocumentJob which runs the full pipeline.
     */
    public function submitDocument(
        User         $user,
        UploadedFile $documentImage,
        UploadedFile $selfieImage,
        string       $docType,
    ): IdentityDocument {
        $this->requireProviderProfile($user);
        $this->requireTierAtLeast($user, TrustTier::BASIC);

        // Persist both files so the async job can access them
        $docPath    = $documentImage->store("kyc/{$user->id}/docs", 'local');
        $selfiePath = $selfieImage->store("kyc/{$user->id}/selfies", 'local');

        // Resubmission: reuse the existing open document (don't create a
        // duplicate) so the admin sees one record with the full progression.
        $existing = $this->openDocumentFor($user, [
            DocType::NRC->value, DocType::PASSPORT->value, DocType::DRIVERS_LICENSE->value,
        ]);

        if ($existing) {
            $existing->fill([
                'doc_type'            => $docType,
                'doc_storage_url'     => $docPath,
                'status'              => DocStatus::MANUAL_REVIEW->value, // back to the human queue
                'confidence_score'    => null,
                'doc_number_hash'     => null,
                'extracted_fields'    => ['selfie_path' => $selfiePath],
                'review_notes'        => null,
                'reviewed_at'         => null,
                'reviewer_admin_id'   => null,
                'reviewer_id'         => null,
                'info_requested_at'   => null,
                'claimed_by_admin_id' => null,
                'claimed_at'          => null,
                'submitted_at'        => now(),
            ]);
            $existing->pushEvent('Resubmitted by applicant', 'Applicant', null, DocStatus::MANUAL_REVIEW->value);
            $existing->save();

            return $existing;
        }

        $doc = new IdentityDocument([
            'user_id'          => $user->id,
            'doc_type'         => $docType,
            'doc_storage_url'  => $docPath,
            'status'           => DocStatus::SUBMITTED->value,
            'submitted_at'     => now(),
            'extracted_fields' => ['selfie_path' => $selfiePath],
        ]);
        $doc->pushEvent('Submitted by applicant', 'Applicant', null, DocStatus::SUBMITTED->value);
        $doc->save();

        // Dispatch async verification — runs the full §4.3 pipeline
        \App\Jobs\VerifyIdentityDocumentJob::dispatch($doc->id, $user->id);

        return $doc;
    }

    /** Latest non-approved document of the given types — the target for a resubmission. */
    private function openDocumentFor(User $user, array $docTypes): ?IdentityDocument
    {
        return IdentityDocument::where('user_id', $user->id)
            ->whereIn('doc_type', $docTypes)
            ->whereNotIn('status', [DocStatus::APPROVED->value, DocStatus::AUTO_APPROVED->value])
            ->latest('submitted_at')
            ->first();
    }

    // ── Tier 3: proof of address ─────────────────────────────────────────────

    /**
     * Submit a proof-of-address document.
     * OCR checks name match + date within 90 days. Fails to manual review.
     */
    public function submitAddress(User $user, UploadedFile $document): IdentityDocument
    {
        $this->requireProviderProfile($user);
        $this->requireTierAtLeast($user, TrustTier::IDENTIFIED);

        $docPath = $document->store("kyc/{$user->id}/address", 'local');

        $existing = $this->openDocumentFor($user, [DocType::PROOF_OF_ADDRESS->value]);

        if ($existing) {
            $existing->fill([
                'doc_storage_url'     => $docPath,
                'status'              => DocStatus::MANUAL_REVIEW->value,
                'review_notes'        => null,
                'reviewed_at'         => null,
                'reviewer_admin_id'   => null,
                'reviewer_id'         => null,
                'info_requested_at'   => null,
                'claimed_by_admin_id' => null,
                'claimed_at'          => null,
                'submitted_at'        => now(),
            ]);
            $existing->pushEvent('Resubmitted by applicant', 'Applicant', null, DocStatus::MANUAL_REVIEW->value);
            $existing->save();

            return $existing;
        }

        $doc = new IdentityDocument([
            'user_id'         => $user->id,
            'doc_type'        => DocType::PROOF_OF_ADDRESS->value,
            'doc_storage_url' => $docPath,
            'status'          => DocStatus::MANUAL_REVIEW->value,  // always manual for PoA
            'submitted_at'    => now(),
        ]);
        $doc->pushEvent('Submitted by applicant', 'Applicant', null, DocStatus::MANUAL_REVIEW->value);
        $doc->save();

        return $doc;
    }

    // ── Core verification pipeline (called from VerifyIdentityDocumentJob) ───

    /**
     * Run the full §4.3 pipeline for a submitted document.
     * Called inside the queued job — exceptions are caught and logged.
     */
    public function runVerificationPipeline(IdentityDocument $doc, User $user): void
    {
        try {
            $docPath    = $doc->doc_storage_url;
            $selfiePath = $doc->extracted_fields['selfie_path'] ?? null;

            if (!$docPath || !$selfiePath) {
                $this->markRejected($doc, 'Missing document or selfie path.');
                return;
            }

            // Step 1: Image quality gate (stub — real impl uses OpenCV thresholds)
            if (!$this->passesImageQualityGate($docPath)) {
                $this->markStatus($doc, DocStatus::AUTO_REJECTED, 'Image quality too low.');
                $this->notifyUser($user, ErrorCode::KYC_LOW_QUALITY->value);
                return;
            }

            // Step 2: Call identity verification provider
            $docFile    = $this->storedFileAsUpload($docPath);
            $selfieFile = $this->storedFileAsUpload($selfiePath);
            $result     = $this->verifier->verifyDocument($docFile, $selfieFile, $doc->doc_type);

            // Step 3: Liveness / face match check
            if ($result->faceMatchScore < self::FACE_MATCH_THRESHOLD) {
                $this->markStatus($doc, DocStatus::AUTO_REJECTED, 'Face match below threshold.');
                $this->notifyUser($user, ErrorCode::KYC_LIVENESS_FAILED->value);
                return;
            }

            // Step 4: Denylist check on hashed doc number
            if ($result->extractedDocNumber) {
                $hash = $this->hashDocNumber($result->extractedDocNumber);
                $doc->update(['doc_number_hash' => $hash]);

                if (FraudDenylist::matchesHash('NRC_HASH', $hash) || FraudDenylist::matchesHash('PASSPORT_HASH', $hash)) {
                    $this->markStatus($doc, DocStatus::AUTO_REJECTED, 'Document matches fraud denylist.');
                    $this->notifyUser($user, ErrorCode::DENYLIST_MATCH->value);
                    $user->update(['account_state' => 'SUSPENDED']);
                    return;
                }

                // Step 5: Duplicate-account check
                $existing = IdentityDocument::where('doc_number_hash', $hash)
                    ->where('user_id', '!=', $user->id)
                    ->where('status', DocStatus::AUTO_APPROVED->value)
                    ->orWhere('status', DocStatus::APPROVED->value)
                    ->exists();

                if ($existing) {
                    $this->markStatus($doc, DocStatus::AUTO_REJECTED, 'Document already linked to another account.');
                    $this->notifyUser($user, ErrorCode::DUPLICATE_IDENTITY->value);
                    return;
                }
            }

            // Step 6: Name consistency (fuzzy Levenshtein ≤ 2)
            $nameConsistent = $this->nameConsistent($result->extractedName, $user->legal_name);

            // Save extracted fields (encrypted in production via cast)
            $doc->update([
                'confidence_score' => $result->confidence,
                'extracted_fields' => [
                    'name'       => $result->extractedName,
                    'doc_number' => $result->extractedDocNumber,
                    'dob'        => $result->extractedDob,
                    'flags'      => $result->flags,
                    'selfie_path'=> $selfiePath,
                ],
            ]);

            // Step 7: Decision
            if ($result->passed(self::MIN_CONFIDENCE, self::FACE_MATCH_THRESHOLD)) {
                if (!$nameConsistent) {
                    // Legitimate name change possible — manual review, not auto-reject
                    $this->markStatus($doc, DocStatus::MANUAL_REVIEW, 'Name mismatch — queued for manual review.');
                    return;
                }

                // Step 7b (v3.2 §4.3): MoMo wallet name match — pulled forward
                // from Tier 3. A second, NRC-anchored identity confirmation
                // that also pre-validates the payout rail. Mismatch → manual
                // review, never auto-reject; no wallet data → don't block.
                if (! $this->momoNameMatches($user, $result->extractedName)) {
                    $this->markStatus(
                        $doc,
                        DocStatus::MANUAL_REVIEW,
                        'MoMo wallet name does not match the verified ID — queued for manual review.',
                    );
                    return;
                }

                $this->markStatus($doc, DocStatus::AUTO_APPROVED);
                $profile = ProviderProfile::where('user_id', $user->id)->first();
                if ($profile) {
                    $this->bumpTier($user, $profile, TrustTier::IDENTIFIED);
                }
            } elseif ($result->isLowConfidence()) {
                $this->markStatus($doc, DocStatus::MANUAL_REVIEW, 'Low confidence — queued for manual review.');
            } else {
                $this->markStatus($doc, DocStatus::AUTO_REJECTED, 'Document failed authenticity checks.');
            }
        } catch (\Throwable $e) {
            Log::error('KYC pipeline failed', ['doc_id' => $doc->id, 'error' => $e->getMessage()]);
            $this->markStatus($doc, DocStatus::MANUAL_REVIEW, 'Pipeline error — queued for manual review.');
        }
    }

    // ── Status queries ───────────────────────────────────────────────────────

    public function getStatus(User $user): array
    {
        $profile = ProviderProfile::where('user_id', $user->id)->first();

        $docs = IdentityDocument::where('user_id', $user->id)
            ->orderByDesc('submitted_at')
            ->get(['id', 'doc_type', 'status', 'confidence_score', 'review_notes', 'info_requested_at', 'submitted_at', 'reviewed_at']);

        $rejected = [DocStatus::AUTO_REJECTED->value, DocStatus::REJECTED->value];

        return [
            'trust_tier'    => $profile?->trust_tier ?? 0,
            'trust_score'   => $profile?->trust_score ?? 0.00,
            'kyc_status'    => $profile?->kyc_status ?? 'PENDING',
            'documents'     => $docs->map(function (IdentityDocument $d) use ($rejected) {
                // The review note is only surfaced to the applicant when it is a
                // message FOR them — an admin's "needs info" note or a rejection
                // reason. Internal pipeline notes on plain pending items stay hidden.
                $infoRequested = $d->info_requested_at !== null;
                $providerNote = ($infoRequested || in_array($d->status, $rejected, true))
                    ? $d->review_notes
                    : null;

                return [
                    'id'               => $d->id,
                    'doc_type'         => $d->doc_type,
                    'status'           => $d->status,
                    'info_requested'   => $infoRequested,
                    'review_note'      => $providerNote,
                    'confidence_score' => $d->confidence_score,
                    'submitted_at'     => $d->submitted_at,
                    'reviewed_at'      => $d->reviewed_at,
                ];
            })->values(),
            'can_resubmit'  => $docs->whereIn('status', $rejected)->isNotEmpty()
                                || $docs->whereNotNull('info_requested_at')->isNotEmpty(),
        ];
    }

    // ── Admin actions ────────────────────────────────────────────────────────

    public function adminApprove(IdentityDocument $doc, User $reviewer, string $notes = ''): void
    {
        $doc->update([
            'status'      => DocStatus::APPROVED->value,
            'reviewer_id' => $reviewer->id,
            'review_notes'=> $notes,
            'reviewed_at' => now(),
        ]);

        $user    = User::find($doc->user_id);
        $profile = ProviderProfile::where('user_id', $doc->user_id)->first();

        if ($user && $profile) {
            $targetTier = match($doc->doc_type) {
                DocType::NRC->value,
                DocType::PASSPORT->value,
                DocType::DRIVERS_LICENSE->value => TrustTier::IDENTIFIED,
                DocType::PROOF_OF_ADDRESS->value  => TrustTier::VERIFIED,
                default                           => null,
            };
            if ($targetTier) {
                $this->bumpTier($user, $profile, $targetTier);
            }
        }
    }

    public function adminReject(IdentityDocument $doc, User $reviewer, string $reason): void
    {
        $doc->update([
            'status'       => DocStatus::REJECTED->value,
            'reviewer_id'  => $reviewer->id,
            'review_notes' => $reason,
            'reviewed_at'  => now(),
        ]);
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function bumpTier(User $user, ProviderProfile $profile, TrustTier $target): void
    {
        if ($profile->trust_tier >= $target->value) {
            return; // Tiers are monotonic — never downgrade here
        }

        $profile->update([
            'trust_tier' => $target->value,
            'kyc_status' => 'VERIFIED',
        ]);
    }

    private function markStatus(IdentityDocument $doc, DocStatus $status, string $notes = ''): void
    {
        $doc->update([
            'status'       => $status->value,
            'review_notes' => $notes ?: null,
            'reviewed_at'  => now(),
        ]);

        $label = match ($status) {
            DocStatus::AUTO_APPROVED => 'Passed automated checks',
            DocStatus::AUTO_REJECTED => 'Failed automated checks',
            DocStatus::MANUAL_REVIEW => 'Routed to manual review',
            default                  => 'Status updated',
        };
        $doc->pushEvent($label, 'Automated checks', $notes ?: null, $status->value, true);
    }

    private function markRejected(IdentityDocument $doc, string $reason): void
    {
        $this->markStatus($doc, DocStatus::AUTO_REJECTED, $reason);
    }

    private function passesImageQualityGate(string $storagePath): bool
    {
        // Stub: always pass in development.
        // Production: call OpenCV brightness/sharpness threshold check.
        return true;
    }

    private function storedFileAsUpload(string $storagePath): UploadedFile
    {
        $fullPath = Storage::disk('local')->path($storagePath);
        return new UploadedFile($fullPath, basename($fullPath), null, null, true);
    }

    private function hashDocNumber(string $rawNumber): string
    {
        $pepper = config('app.kyc_hash_pepper', env(self::DOC_NUMBER_PEPPER_ENV, 'default-pepper'));
        return hash('sha256', $rawNumber . $pepper);
    }

    private function nameConsistent(?string $extracted, ?string $declared): bool
    {
        if (!$extracted || !$declared) return true; // can't check → don't block
        $a = strtolower(trim($extracted));
        $b = strtolower(trim($declared));
        return levenshtein($a, $b) <= 2;
    }

    /**
     * v3.2 §4.3 — fuzzy match between the verified ID name and the registered
     * MoMo wallet name. Returns true (don't block) when the check is disabled,
     * the provider has no wallet on file, or the aggregator can't answer —
     * absence of data is never a failure; only a real mismatch is.
     */
    private function momoNameMatches(User $user, ?string $verifiedIdName): bool
    {
        if (! config('trust.momo_name_match.enabled')) {
            return true;
        }

        $idName = $verifiedIdName ?: $user->legal_name;
        if (! $idName) {
            return true;
        }

        $profile = ProviderProfile::where('user_id', $user->id)->first();
        if (! $profile || empty($profile->momo_provider) || empty($profile->momo_number)) {
            return true;
        }

        $walletName = $this->walletNames->lookupName($profile->momo_provider, $profile->momo_number);
        if (! $walletName) {
            return true;
        }

        return self::namesFuzzyMatch($idName, $walletName, (int) config('trust.momo_name_match.max_levenshtein', 2));
    }

    /**
     * Normalized fuzzy comparison: lowercase, strip everything but letters and
     * single spaces, compare order-insensitively (wallet registrations often
     * flip surname/given-name order), Levenshtein ≤ $maxDistance.
     */
    public static function namesFuzzyMatch(string $a, string $b, int $maxDistance = 2): bool
    {
        $normalize = function (string $name): array {
            $name  = mb_strtolower(trim($name));
            $name  = preg_replace('/[^a-z\s]/u', '', $name) ?? '';
            $parts = preg_split('/\s+/', $name, -1, PREG_SPLIT_NO_EMPTY) ?: [];
            sort($parts);
            return $parts;
        };

        $na = implode(' ', $normalize($a));
        $nb = implode(' ', $normalize($b));

        if ($na === '' || $nb === '') {
            return true; // nothing comparable → don't block
        }

        return levenshtein($na, $nb) <= $maxDistance;
    }

    private function requireProviderProfile(User $user): ProviderProfile
    {
        $profile = ProviderProfile::where('user_id', $user->id)->first();
        if (!$profile) {
            throw new ApiException(ErrorCode::FORBIDDEN, 'Provider profile not found. Complete your profile setup first.');
        }
        return $profile;
    }

    private function requireTierAtLeast(User $user, TrustTier $required): void
    {
        $profile = ProviderProfile::where('user_id', $user->id)->value('trust_tier') ?? 0;
        if ($profile < $required->value) {
            throw new ApiException(
                ErrorCode::FORBIDDEN,
                "Tier {$required->label()} required. Current tier: " . TrustTier::from($profile)->label() . '.',
            );
        }
    }

    private function notifyUser(User $user, string $code): void
    {
        // TODO: integrate notification dispatch (Phase 8)
        Log::info('KYC notification', ['user_id' => $user->id, 'code' => $code]);
    }
}
