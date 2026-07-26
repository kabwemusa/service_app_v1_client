<?php

namespace App\Services\Legal;

use App\Enums\ConsentEvent;
use App\Enums\LegalDocumentType;
use App\Models\ConsentRecord;
use App\Models\DataSubjectRequest;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The consent MECHANISM. This is the part the Data Protection Act No. 3 of 2021
 * cares about most: consent must be freely given, informed, specific, unbundled
 * for optional processing, and the controller must be able to DEMONSTRATE it and
 * honour its withdrawal.
 *
 * Every write here appends an immutable row to consent_records; nothing is ever
 * mutated in place. `statusFor()` reconstructs the user's current standing by
 * replaying those rows against the current required versions.
 */
class ConsentService
{
    public function __construct(private readonly LegalDocumentRepository $docs) {}

    /**
     * The user's current consent standing:
     *   - needs_consent  : must they (re)accept before using the app?
     *   - reason         : NEW | VERSION_CHANGE | null
     *   - outstanding    : the required docs whose version they have not accepted
     *   - required        : current required docs [{type, version, title}]
     *   - marketing_opt_in / analytics_opt_in : current optional state
     *   - core_withdrawn : has core consent been withdrawn?
     */
    public function statusFor(User $user): array
    {
        $required = $this->docs->currentRequired(); // keyed by type value

        // Latest positive consent (GRANT/RECONSENT) drives accepted versions +
        // optional toggles; later WITHDRAW rows override the toggles / core.
        $records = ConsentRecord::where('user_id', $user->id)
            ->orderByDesc('created_at')->get();

        $lastGrant = $records->firstWhere(
            fn ($r) => in_array($r->event, [ConsentEvent::GRANT->value, ConsentEvent::RECONSENT->value], true)
        );

        // Accepted version per doc type, from the most recent grant.
        $accepted = [];
        if ($lastGrant && is_array($lastGrant->documents)) {
            foreach ($lastGrant->documents as $d) {
                if (isset($d['type'], $d['version'])) {
                    $accepted[$d['type']] = $d['version'];
                }
            }
        }

        // Optional toggles: start from the last grant, then apply any newer
        // WITHDRAW events for a specific optional scope.
        $marketing = $lastGrant?->marketing_opt_in ?? false;
        $analytics = $lastGrant?->analytics_opt_in ?? false;
        $coreWithdrawn = false;

        foreach ($records as $r) {
            if ($r->event !== ConsentEvent::WITHDRAW->value) {
                continue;
            }
            // Only withdrawals AFTER the last grant affect current standing.
            if ($lastGrant && $r->created_at < $lastGrant->created_at) {
                continue;
            }
            match ($r->withdrawn_scope) {
                'marketing' => $marketing = false,
                'analytics' => $analytics = false,
                'CORE'      => $coreWithdrawn = true,
                default     => null,
            };
        }

        // Determine outstanding required docs (never accepted OR version changed).
        $outstanding = [];
        foreach (LegalDocumentType::required() as $type) {
            $doc = $required->get($type->value);
            if (! $doc) {
                // No current document exists for a required type — treat as
                // outstanding so the app doesn't silently skip a missing agreement.
                $outstanding[] = ['type' => $type->value, 'version' => null];
                continue;
            }
            $acceptedVersion = $accepted[$type->value] ?? null;
            if ($acceptedVersion !== $doc->version) {
                $outstanding[] = ['type' => $type->value, 'version' => $doc->version];
            }
        }

        $hasAnyGrant = $lastGrant !== null;
        $needsConsent = $coreWithdrawn || count($outstanding) > 0;
        $reason = null;
        if ($needsConsent) {
            $reason = (! $hasAnyGrant || $coreWithdrawn) ? 'NEW' : 'VERSION_CHANGE';
        }

        return [
            'needs_consent'    => $needsConsent,
            'reason'           => $reason,
            'core_withdrawn'   => $coreWithdrawn,
            'outstanding'      => $outstanding,
            'required'         => $required->values()->map(fn ($d) => [
                'type'           => $d->type,
                'version'        => $d->version,
                'title'          => $d->title,
                'effective_date' => $d->effective_date?->toDateString(),
            ])->all(),
            'marketing_opt_in' => $marketing,
            'analytics_opt_in' => $analytics,
            'accepted'         => $accepted,
        ];
    }

    /**
     * Record acceptance of the required documents plus the (unbundled) optional
     * toggles. Appends a GRANT or RECONSENT row.
     *
     * @param  array  $meta  platform, app_version, ip_address, user_agent
     */
    public function grant(User $user, bool $marketing, bool $analytics, array $meta = []): ConsentRecord
    {
        $required = $this->docs->currentRequired();

        // Snapshot the EXACT versions being accepted — this is the evidence.
        $documents = $required->values()->map(fn ($d) => [
            'type'    => $d->type,
            'version' => $d->version,
        ])->all();

        // First grant vs re-acceptance after a material bump.
        $hasPrior = ConsentRecord::where('user_id', $user->id)
            ->whereIn('event', [ConsentEvent::GRANT->value, ConsentEvent::RECONSENT->value])
            ->exists();

        return DB::transaction(fn () => ConsentRecord::create([
            'user_id'          => $user->id,
            'event'            => $hasPrior ? ConsentEvent::RECONSENT->value : ConsentEvent::GRANT->value,
            'documents'        => $documents,
            'marketing_opt_in' => $marketing,
            'analytics_opt_in' => $analytics,
            'platform'         => $meta['platform']    ?? null,
            'app_version'      => $meta['app_version']  ?? null,
            'ip_address'       => $meta['ip_address']   ?? null,
            'user_agent'       => $meta['user_agent']   ?? null,
        ]));
    }

    /** Record that the user declined at the gate. They cannot proceed. */
    public function decline(User $user, array $meta = []): ConsentRecord
    {
        return ConsentRecord::create([
            'user_id'     => $user->id,
            'event'       => ConsentEvent::DECLINE->value,
            'platform'    => $meta['platform']   ?? null,
            'app_version' => $meta['app_version'] ?? null,
            'ip_address'  => $meta['ip_address']  ?? null,
            'user_agent'  => $meta['user_agent']  ?? null,
        ]);
    }

    /**
     * Withdraw consent for a scope: 'marketing' | 'analytics' | 'CORE'.
     * Withdrawing CORE means the service can no longer be provided — the caller
     * surfaces that and may open an account-closure request separately.
     */
    public function withdraw(User $user, string $scope, array $meta = []): ConsentRecord
    {
        return ConsentRecord::create([
            'user_id'         => $user->id,
            'event'           => ConsentEvent::WITHDRAW->value,
            'withdrawn_scope' => $scope,
            'platform'        => $meta['platform']    ?? null,
            'app_version'     => $meta['app_version']  ?? null,
            'ip_address'      => $meta['ip_address']   ?? null,
            'user_agent'      => $meta['user_agent']   ?? null,
        ]);
    }

    /**
     * Capture a data-subject-rights request. The USER-FACING right and the record
     * of the request are what the Act requires to exist now.
     *
     * STUB BOUNDARY: actual fulfilment (compiling an access/portability export or
     * performing an erasure) is intentionally out of scope this phase and is not
     * done here. A future ErasureService / DataExportService reads RECEIVED rows,
     * performs the action, and marks them COMPLETED. Do not delete user data from
     * this method.
     */
    public function openDataSubjectRequest(User $user, string $type, ?string $details = null): DataSubjectRequest
    {
        return DataSubjectRequest::create([
            'user_id' => $user->id,
            'type'    => $type,
            'status'  => 'RECEIVED',
            'details' => $details,
        ]);
    }

    /** The user's own consent history (append-only), newest first. */
    public function history(User $user)
    {
        return ConsentRecord::where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->get();
    }
}
