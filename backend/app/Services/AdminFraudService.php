<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Models\AdminUser;
use App\Models\FraudDenylist;
use App\Models\FraudSignalReview;
use App\Models\User;
use App\Support\IdentifierHash;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Backend for the admin Fraud & Denylist module (UI: admin/src/components/fraud).
 *
 * Patterns tab surfaces signals COMPUTED FROM existing data — it never
 * invents a detector that doesn't already have a real data source:
 *   - REVIEW_SPIKE:      reuses AdminReviewModerationService's spike predicate
 *                         (5+ reviews on one provider within 24h)
 *   - FAILED_PAYMENTS:   repeated PAY_IN failures for the same buyer (Transaction)
 *   - DUPLICATE_IDENTITY: same NRC/passport hash across different accounts
 *                         (IdentityDocument.doc_number_hash)
 *   - DENYLIST_MATCH:    a KYC submission was auto-rejected because it matched
 *                         the denylist (KycService already enforces this at
 *                         submission time — this surfaces the catch)
 *   - MOMO_REUSE:        the same MoMo number registered on multiple provider
 *                         profiles (a real payout-evasion pattern; there is no
 *                         device-fingerprint column anywhere in this schema,
 *                         so "same device" is NOT claimed here)
 *
 * Workflow state (claimed/investigating/escalated/false_positive) is tracked
 * in FraudSignalReview since the signals themselves are computed, not rows.
 */
class AdminFraudService
{
    private const SPIKE_THRESHOLD = 5;
    private const SPIKE_WINDOW = "interval '24 hours'";
    private const FAILED_PAYMENT_THRESHOLD = 3;
    private const FAILED_PAYMENT_WINDOW = "interval '7 days'";

    public function __construct(private readonly AuditedMutationService $audit) {}

    // ── Patterns (computed signals + workflow state) ─────────────────────────────

    public function patterns(array $filters): array
    {
        $signals = collect()
            ->concat($this->reviewSpikeSignals())
            ->concat($this->failedPaymentSignals())
            ->concat($this->duplicateIdentitySignals())
            ->concat($this->denylistMatchSignals())
            ->concat($this->momoReuseSignals());

        $reviews = FraudSignalReview::whereIn('signal_key', $signals->pluck('signal_key'))->get()->keyBy('signal_key');

        $rows = $signals->map(function (array $s) use ($reviews) {
            $review = $reviews->get($s['signal_key']);
            return [
                'signal_key'    => $s['signal_key'],
                'signal_type'   => $s['signal_type'],
                'severity'      => $s['severity'],
                'affected_users'=> $s['affected_users'],
                'source_module' => $s['source_module'],
                'source_id'     => $s['source_id'],
                'detected_at'   => $s['detected_at'],
                'status'        => $review->status ?? 'open',
                'assigned_admin_name' => $review?->assignedAdmin?->name,
            ];
        });

        if (!empty($filters['status'])) {
            $rows = $rows->where('status', $filters['status']);
        }
        if (!empty($filters['signal_type'])) {
            $rows = $rows->where('signal_type', $filters['signal_type']);
        }

        return $rows->sortByDesc('detected_at')->values()->all();
    }

    private function reviewSpikeSignals(): \Illuminate\Support\Collection
    {
        $rows = DB::select("
            SELECT reviewee_id, COUNT(*) as cnt, MAX(created_at) as latest
            FROM reviews
            WHERE removed_at IS NULL AND created_at > NOW() - " . self::SPIKE_WINDOW . "
            GROUP BY reviewee_id
            HAVING COUNT(*) >= " . self::SPIKE_THRESHOLD . "
        ");

        return collect($rows)->map(fn ($r) => [
            'signal_key'     => "review_spike:{$r->reviewee_id}:" . Carbon::parse($r->latest)->toDateString(),
            'signal_type'    => 'REVIEW_SPIKE',
            'severity'       => 'MEDIUM',
            'affected_users' => [$this->userLabel($r->reviewee_id)],
            'source_module'  => 'reviews',
            'source_id'      => $r->reviewee_id,
            'detected_at'    => $this->iso($r->latest),
        ]);
    }

    private function failedPaymentSignals(): \Illuminate\Support\Collection
    {
        $rows = DB::select("
            SELECT t.booking_id, b.buyer_id, COUNT(*) as cnt, MAX(t.updated_at) as latest
            FROM transactions t
            JOIN bookings b ON b.id = t.booking_id
            WHERE t.type = 'PAY_IN' AND t.status = 'FAILED'
              AND t.updated_at > NOW() - " . self::FAILED_PAYMENT_WINDOW . "
            GROUP BY t.booking_id, b.buyer_id
        ");

        $byBuyer = collect($rows)->groupBy('buyer_id')->filter(fn ($g) => $g->sum('cnt') >= self::FAILED_PAYMENT_THRESHOLD);

        return $byBuyer->map(function ($g, $buyerId) {
            $latest = $g->max('latest');
            return [
                'signal_key'     => "failed_payments:{$buyerId}:" . Carbon::parse($latest)->toDateString(),
                'signal_type'    => 'FAILED_PAYMENTS',
                'severity'       => 'MEDIUM',
                'affected_users' => [$this->userLabel($buyerId)],
                'source_module'  => null,
                'source_id'      => $buyerId,
                'detected_at'    => $this->iso($latest),
            ];
        })->values();
    }

    private function duplicateIdentitySignals(): \Illuminate\Support\Collection
    {
        $rows = DB::select("
            SELECT doc_number_hash, array_agg(DISTINCT user_id) as user_ids, MAX(submitted_at) as latest
            FROM identity_documents
            WHERE doc_number_hash IS NOT NULL AND status != 'AUTO_REJECTED'
            GROUP BY doc_number_hash
            HAVING COUNT(DISTINCT user_id) > 1
        ");

        return collect($rows)->map(function ($r) {
            $userIds = is_string($r->user_ids) ? trim($r->user_ids, '{}') : implode(',', (array) $r->user_ids);
            $ids = array_filter(explode(',', $userIds));
            return [
                'signal_key'     => "duplicate_identity:{$r->doc_number_hash}",
                'signal_type'    => 'DUPLICATE_IDENTITY',
                'severity'       => 'HIGH',
                'affected_users' => array_map(fn ($id) => $this->userLabel($id), $ids),
                'source_module'  => null,
                'source_id'      => null,
                'detected_at'    => $this->iso($r->latest),
            ];
        });
    }

    private function denylistMatchSignals(): \Illuminate\Support\Collection
    {
        $rows = DB::table('identity_documents')
            ->where('status', 'AUTO_REJECTED')
            ->where('review_notes', 'like', '%denylist%')
            ->orderByDesc('reviewed_at')
            ->limit(50)
            ->get(['id', 'user_id', 'reviewed_at']);

        return $rows->map(fn ($r) => [
            'signal_key'     => "denylist_match:{$r->id}",
            'signal_type'    => 'DENYLIST_MATCH',
            'severity'       => 'HIGH',
            'affected_users' => [$this->userLabel($r->user_id)],
            'source_module'  => null,
            'source_id'      => $r->id,
            'detected_at'    => $this->iso($r->reviewed_at),
        ]);
    }

    private function momoReuseSignals(): \Illuminate\Support\Collection
    {
        $rows = DB::select("
            SELECT momo_number, array_agg(DISTINCT user_id) as user_ids, MAX(updated_at) as latest
            FROM provider_profiles
            WHERE momo_number IS NOT NULL
            GROUP BY momo_number
            HAVING COUNT(DISTINCT user_id) > 1
        ");

        return collect($rows)->map(function ($r) {
            $userIds = is_string($r->user_ids) ? trim($r->user_ids, '{}') : implode(',', (array) $r->user_ids);
            $ids = array_filter(explode(',', $userIds));
            return [
                'signal_key'     => "momo_reuse:{$r->momo_number}",
                'signal_type'    => 'MOMO_REUSE',
                'severity'       => 'MEDIUM',
                'affected_users' => array_map(fn ($id) => $this->userLabel($id), $ids),
                'source_module'  => null,
                'source_id'      => null,
                'detected_at'    => $this->iso($r->latest),
            ];
        });
    }

    // ── Pattern workflow actions (audited) ────────────────────────────────────────

    public function claimSignal(array $signal, AdminUser $actor, string $reason): array
    {
        $review = $this->findOrCreateReview($signal);

        $this->audit->perform(
            actor: $actor,
            action: 'fraud.signal_claim',
            targetType: 'fraud_signal',
            targetId: $review->id,
            reason: $reason,
            metadata: ['before' => ['status' => $review->status], 'after' => ['status' => 'investigating']],
            mutation: fn () => $review->forceFill(['status' => 'investigating', 'assigned_admin_id' => $actor->id])->save(),
        );

        return $review->fresh()->toArray();
    }

    public function markFalsePositive(array $signal, AdminUser $actor, string $reason): array
    {
        $review = $this->findOrCreateReview($signal);

        $this->audit->perform(
            actor: $actor,
            action: 'fraud.signal_false_positive',
            targetType: 'fraud_signal',
            targetId: $review->id,
            reason: $reason,
            metadata: ['after' => ['status' => 'false_positive']],
            mutation: fn () => $review->forceFill(['status' => 'false_positive'])->save(),
        );

        return $review->fresh()->toArray();
    }

    public function escalateSignal(array $signal, AdminUser $actor, string $reason): array
    {
        $review = $this->findOrCreateReview($signal);

        $this->audit->perform(
            actor: $actor,
            action: 'fraud.signal_escalate',
            targetType: 'fraud_signal',
            targetId: $review->id,
            reason: $reason,
            metadata: ['after' => ['status' => 'escalated']],
            mutation: fn () => $review->forceFill(['status' => 'escalated', 'assigned_admin_id' => $actor->id])->save(),
        );

        return $review->fresh()->toArray();
    }

    private function findOrCreateReview(array $signal): FraudSignalReview
    {
        return FraudSignalReview::firstOrCreate(
            ['signal_key' => $signal['signal_key']],
            [
                'signal_type'    => $signal['signal_type'],
                'severity'       => $signal['severity'],
                'affected_users' => $signal['affected_users'],
                'source_module'  => $signal['source_module'] ?? null,
                'source_id'      => $signal['source_id'] ?? null,
                'detected_at'    => $signal['detected_at'],
            ],
        );
    }

    // ── Denylist ─────────────────────────────────────────────────────────────────

    public function denylist(array $filters): array
    {
        $query = FraudDenylist::query()->orderByDesc('added_at');

        if (!empty($filters['type'])) {
            $query->where('hash_type', $filters['type']);
        }
        if (!empty($filters['status'])) {
            $filters['status'] === 'active'
                ? $query->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
                : $query->whereNotNull('expires_at')->where('expires_at', '<=', now());
        }
        if (!empty($filters['search'])) {
            // Search by masked preview means matching the last 4 chars of the hash — a
            // convenience lookup, not a way to reconstruct the raw identifier.
            $query->where('hash_value', 'like', '%' . substr($filters['search'], -4));
        }

        $page = $query->paginate(20, ['*'], 'page', (int) ($filters['page'] ?? 1));

        return [
            'data' => collect($page->items())->map(fn (FraudDenylist $d) => [
                'id'         => $d->id,
                'type'       => $d->hash_type,
                'masked'     => $this->maskHash($d->hash_type, $d->hash_value),
                'reason'     => $d->reason,
                'added_by'   => $d->added_by,
                'added_at'   => $this->iso($d->added_at),
                'expires_at' => $this->iso($d->expires_at),
                'status'     => (!$d->expires_at || $d->expires_at->isFuture()) ? 'active' : 'lifted',
            ])->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page'    => $page->lastPage(),
                'per_page'     => $page->perPage(),
                'total'        => $page->total(),
            ],
        ];
    }

    /** Add a HASH-only denylist entry. Never stores or returns the raw identifier. */
    public function addToDenylist(AdminUser $actor, string $hashType, string $rawIdentifier, string $category, string $reason): array
    {
        $hash = IdentifierHash::for($hashType, $rawIdentifier);

        if (FraudDenylist::where('hash_type', $hashType)->where('hash_value', $hash)->exists()) {
            throw new ApiException(ErrorCode::CONFLICT, 'This identifier is already on the denylist.');
        }

        $entry = $this->audit->perform(
            actor: $actor,
            action: 'fraud.denylist_add',
            targetType: 'fraud_denylist',
            targetId: $hash,
            reason: $reason,
            metadata: ['after' => ['hash_type' => $hashType, 'category' => $category]],
            mutation: fn () => FraudDenylist::create([
                'hash_type'  => $hashType,
                'hash_value' => $hash,
                'reason'     => $category,
                'added_by'   => $actor->id,
                'added_at'   => now(),
                'expires_at' => null,
            ]),
        );

        return $this->denylistEntryPresenter($entry);
    }

    public function liftFromDenylist(FraudDenylist $entry, AdminUser $actor, string $reason): array
    {
        $this->audit->perform(
            actor: $actor,
            action: 'fraud.denylist_lift',
            targetType: 'fraud_denylist',
            targetId: $entry->id,
            reason: $reason,
            metadata: ['before' => ['expires_at' => null], 'after' => ['expires_at' => now()->toIso8601String()]],
            mutation: fn () => $entry->forceFill(['expires_at' => now()])->save(),
        );

        return $this->denylistEntryPresenter($entry->fresh());
    }

    /** Export masked/hashed entries for MNO/gateway sharing — hashes only, never raw values. */
    public function exportDenylist(): array
    {
        return FraudDenylist::where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->get(['hash_type', 'hash_value', 'reason', 'added_at'])
            ->map(fn ($d) => [
                'hash_type'  => $d->hash_type,
                'hash_value' => $d->hash_value,
                'reason'     => $d->reason,
                'added_at'   => $this->iso($d->added_at),
            ])->all();
    }

    private function denylistEntryPresenter(FraudDenylist $d): array
    {
        return [
            'id'         => $d->id,
            'type'       => $d->hash_type,
            'masked'     => $this->maskHash($d->hash_type, $d->hash_value),
            'reason'     => $d->reason,
            'added_at'   => $this->iso($d->added_at),
            'expires_at' => $this->iso($d->expires_at),
            'status'     => (!$d->expires_at || $d->expires_at->isFuture()) ? 'active' : 'lifted',
        ];
    }

    // ── Escalations (from other modules, read-only, links back) ─────────────────

    public function escalations(): array
    {
        $fromReviews = collect($this->reviewSpikeSignals())->map(fn ($s) => $this->toEscalationRow($s, 'Reviews'));

        $safetyHigh = DB::table('safety_reports')
            ->where('severity', 'HIGH')
            ->whereIn('status', ['OPEN', 'UNDER_REVIEW'])
            ->orderByDesc('reported_at')
            ->limit(50)
            ->get(['id', 'reported_id', 'reported_at']);

        $fromSafety = $safetyHigh->map(fn ($r) => [
            'signal_key'    => "safety_report:{$r->id}",
            'signal_type'   => 'SAFETY_ESCALATION',
            'severity'      => 'HIGH',
            'affected_users'=> [$this->userLabel($r->reported_id)],
            'source_module' => 'safety',
            'source_id'     => $r->id,
            'detected_at'   => $this->iso($r->reported_at),
        ]);

        $signals = $fromReviews->concat($fromSafety);
        $reviews = FraudSignalReview::whereIn('signal_key', $signals->pluck('signal_key'))->get()->keyBy('signal_key');

        return $signals->map(function ($s) use ($reviews) {
            $review = $reviews->get($s['signal_key']);
            return array_merge($s, [
                'status'              => $review->status ?? 'open',
                'assigned_admin_name' => $review?->assignedAdmin?->name,
            ]);
        })->sortByDesc('detected_at')->values()->all();
    }

    private function toEscalationRow(array $signal, string $sourceLabel): array
    {
        return array_merge($signal, ['source_module' => strtolower($sourceLabel)]);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private function userLabel(?string $userId): array
    {
        if (!$userId) return ['id' => null, 'name' => 'Unknown'];

        $u = DB::table('users as u')
            ->leftJoin('provider_profiles as pp', 'pp.user_id', '=', 'u.id')
            ->where('u.id', $userId)
            ->first(['u.id', 'u.legal_name', 'u.email', 'pp.display_name']);

        if (!$u) return ['id' => $userId, 'name' => 'Deleted user'];

        return ['id' => $u->id, 'name' => $u->display_name ?? $u->legal_name ?? explode('@', $u->email ?? 'user')[0]];
    }

    private function maskHash(string $type, string $hash): string
    {
        $label = match ($type) {
            'PHONE_HASH'       => 'Phone',
            'EMAIL_HASH'       => 'Email',
            'NRC_HASH'         => 'NRC',
            'PASSPORT_HASH'    => 'Passport',
            'DEVICE_HASH'      => 'Device',
            'MOMO_NUMBER_HASH' => 'MoMo',
            default            => $type,
        };
        return "{$label} •••" . mb_substr($hash, -4);
    }

    private function iso($value): ?string
    {
        if ($value === null) return null;
        return $value instanceof \DateTimeInterface
            ? $value->format(\DateTimeInterface::ATOM)
            : Carbon::parse($value)->toIso8601String();
    }
}
