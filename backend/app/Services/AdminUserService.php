<?php

namespace App\Services;

use App\Enums\AccountState;
use App\Enums\ErrorCode;
use App\Enums\TrustTier;
use App\Events\AccountModerated;
use App\Exceptions\Api\ApiException;
use App\Models\AdminUser;
use App\Models\FraudDenylist;
use App\Models\User;
use App\Support\AdminCapabilities;
use App\Support\IdentifierHash;
use Illuminate\Support\Facades\DB;

/**
 * Backend for the admin Users module (UI: admin/src/components/users).
 *
 * It is the central people record other modules deep-link into. It maps
 * `users` (+ provider_profiles, bookings, reviews, commissions, reports) into
 * the shapes the panel consumes, and runs every moderation action through
 * AuditedMutationService so each writes an audit entry in one transaction.
 *
 * PRIVACY (§ enforced here):
 *   - Contact / legal name are MASKED in every list & detail response. The raw
 *     values are only returned by revealPii(), which itself writes a PII-access
 *     audit entry. Callers must hold users.view_pii (route-gated).
 *   - The public avatar (provider_profiles.avatar_url) is the ONLY image exposed
 *     — never the KYC selfie (that lives in the Verification module).
 *   - trust_score / risk_score (internal 0–1 numbers) are only attached for
 *     admins holding read:fraud, and never leave the admin surface.
 *   - Denylist additions store the SHA-256 hash only, never the raw identifier.
 */
class AdminUserService
{
    /** Audit actions that count as a moderation state change (for "latest reason"). */
    private const MODERATION_ACTIONS = [
        'user.warn', 'user.suspend', 'user.ban', 'user.reinstate',
        'user.restrict', 'user.adjust_tier',
    ];

    private const OPEN_DISPUTE_STATES = ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE'];

    public function __construct(
        private readonly AuditedMutationService $audit,
        private readonly AuthService $authService,
        private readonly NotificationDispatcher $notifications,
    ) {}

    // ── List ───────────────────────────────────────────────────────────────────

    public function list(array $filters): array
    {
        $flaggedExpr = $this->flaggedExpression();

        $query = DB::table('users as u')
            ->leftJoin('provider_profiles as pp', 'pp.user_id', '=', 'u.id')
            ->select([
                'u.id', 'u.role', 'u.account_state', 'u.legal_name', 'u.email',
                'u.warned_at', 'u.r_raw', 'u.v_reviews', 'u.created_at',
                'pp.display_name', 'pp.trust_tier', 'pp.cancellation_rate_30d',
            ])
            ->selectRaw("$flaggedExpr as flagged")
            // a user is a provider if they have a profile row (or PROVIDER role)
            ->selectRaw("(pp.user_id IS NOT NULL OR u.role = 'PROVIDER') as is_provider");

        // Search by name / phone / email / id
        if (!empty($filters['search'])) {
            $search = $filters['search'];
            $term   = '%' . $search . '%';
            // u.id is a UUID column — comparing it against a non-UUID string
            // throws in Postgres, so only add that clause when the search
            // term is actually shaped like a UUID.
            $isUuid = (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $search);

            $query->where(function ($w) use ($term, $search, $isUuid) {
                $w->where('u.legal_name', 'ilike', $term)
                  ->orWhere('pp.display_name', 'ilike', $term)
                  ->orWhere('u.email', 'ilike', $term)
                  ->orWhere('u.phone', 'ilike', $term);
                if ($isUuid) {
                    $w->orWhere('u.id', '=', $search);
                }
            });
        }

        // Role filter
        match ($filters['role'] ?? '') {
            'provider' => $query->whereNotNull('pp.user_id'),
            'customer' => $query->whereNull('pp.user_id'),
            'both'     => $query->whereNotNull('pp.user_id')
                                ->whereExists(fn ($q) => $q->select(DB::raw(1))->from('bookings as b')->whereColumn('b.buyer_id', 'u.id')),
            default    => null,
        };

        // Status filter
        match ($filters['status'] ?? '') {
            'active'    => $query->where('u.account_state', 'ACTIVE')->whereNull('u.warned_at'),
            'warned'    => $query->where('u.account_state', 'ACTIVE')->whereNotNull('u.warned_at'),
            'restricted'=> $query->where('u.account_state', 'RESTRICTED'),
            'suspended' => $query->where('u.account_state', 'SUSPENDED'),
            'banned'    => $query->where('u.account_state', 'BANNED'),
            default     => null,
        };

        // Tier filter (no profile == tier 0)
        if (($filters['tier'] ?? '') !== '') {
            $tier = (int) $filters['tier'];
            $tier === 0
                ? $query->where(fn ($q) => $q->whereNull('pp.trust_tier')->orWhere('pp.trust_tier', 0))
                : $query->where('pp.trust_tier', $tier);
        }

        // Flagged filter
        if (($filters['flagged'] ?? '') === '1' || ($filters['flagged'] ?? '') === 'true') {
            $query->whereRaw("$flaggedExpr = 1");
        }

        // Default sort: flagged surfaced first, then newest.
        $query->orderByRaw("$flaggedExpr DESC")->orderByDesc('u.created_at');

        $page = $query->paginate(20, ['*'], 'page', (int) ($filters['page'] ?? 1));

        return [
            'data' => collect($page->items())->map(fn ($row) => $this->presentRow($row))->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page'    => $page->lastPage(),
                'per_page'     => $page->perPage(),
                'total'        => $page->total(),
            ],
        ];
    }

    private function flaggedExpression(): string
    {
        $states = "'" . implode("','", self::OPEN_DISPUTE_STATES) . "'";

        return "(CASE
            WHEN u.risk_score > 0.5 THEN 1
            WHEN u.account_state = 'RESTRICTED' THEN 1
            WHEN EXISTS (SELECT 1 FROM safety_reports sr WHERE sr.reported_id = u.id AND sr.reviewed_at IS NULL) THEN 1
            WHEN EXISTS (SELECT 1 FROM disputes d WHERE d.against = u.id AND d.status IN ($states)) THEN 1
            ELSE 0 END)";
    }

    private function presentRow(object $row): array
    {
        $isProvider = (bool) $row->is_provider;

        return [
            'id'                => $row->id,
            'display_name'      => $this->displayName($row->display_name, $row->legal_name, $row->email),
            'role'              => $this->roleLabel($row->role, $isProvider),
            'is_provider'       => $isProvider,
            'trust_tier'        => (int) ($row->trust_tier ?? 0),
            'account_status'    => $this->accountStatus($row->account_state, $row->warned_at),
            'rating'            => $row->v_reviews > 0 ? round((float) $row->r_raw, 2) : null,
            'reviews_count'     => (int) $row->v_reviews,
            'cancellation_rate' => $isProvider ? (float) ($row->cancellation_rate_30d ?? 0) : null,
            'flagged'           => (int) $row->flagged === 1,
            'created_at'        => $this->iso($row->created_at),
        ];
    }

    // ── Detail ───────────────────────────────────────────────────────────────────

    public function detail(User $user, AdminUser $actor): array
    {
        $user->loadMissing('providerProfile');
        $profile    = $user->providerProfile;
        $isProvider = $profile !== null || $user->role === 'PROVIDER';

        $bookingsCount  = DB::table('bookings')->where('buyer_id', $user->id)->orWhere('provider_id', $user->id)->count();
        $recentBookings = $this->recentBookings($user);
        $services       = $isProvider ? $this->services($user) : ['count' => 0, 'items' => []];

        $reviewsGiven    = DB::table('reviews')->where('reviewer_id', $user->id)->count();
        $reviewsReceived = DB::table('reviews')->where('reviewee_id', $user->id)->count();
        $reportsFiled    = DB::table('safety_reports')->where('reporter_id', $user->id)->count();
        $reportsAgainst  = DB::table('safety_reports')->where('reported_id', $user->id)->count();
        $referralsCount  = DB::table('users')->where('referred_by', $user->id)->count();

        $finance = $this->directFinance($user);

        $canViewInternal = AdminCapabilities::roleHas($actor->role, 'read:fraud');

        return [
            'id'                 => $user->id,
            'display_name'       => $this->displayName($profile?->display_name, $user->legal_name, $user->email),
            // Public avatar only — NEVER the KYC selfie.
            'avatar_url'         => $profile?->avatar_url,
            'role'               => $this->roleLabel($user->role, $isProvider),
            'is_provider'        => $isProvider,
            'account_state'      => $user->account_state,
            'account_status'     => $this->accountStatus($user->account_state, $user->warned_at),
            'trust_tier'         => (int) ($profile?->trust_tier ?? 0),
            'tier_label'         => TrustTier::from((int) ($profile?->trust_tier ?? 0))->label(),
            'verification_state' => $profile?->kyc_status,
            'warned_at'          => $this->iso($user->warned_at),
            'suspended_until'    => $this->iso($user->suspended_until),
            'moderation_reason'  => $this->latestModerationReason($user->id),
            'contact'            => $this->maskedContact($user),
            'signals'            => [
                'rating'            => $user->v_reviews > 0 ? round((float) $user->r_raw, 2) : null,
                'reviews_count'     => (int) $user->v_reviews,
                'cancellation_rate' => $isProvider ? (float) ($profile?->cancellation_rate_30d ?? 0) : null,
                'response_rate'     => $isProvider ? (float) ($profile?->response_rate_7d ?? 0) : null,
            ],
            // Internal-only composite scores — never leave the admin surface.
            'internal'           => $canViewInternal ? [
                'trust_score' => $profile ? (float) $profile->trust_score : null,
                'risk_score'  => (float) ($user->risk_score ?? 0),
            ] : null,
            'activity'           => [
                'bookings_count'   => $bookingsCount,
                'recent_bookings'  => $recentBookings,
                'services_count'   => $services['count'],
                'services'         => $services['items'],
                'reviews_given'    => $reviewsGiven,
                'reviews_received' => $reviewsReceived,
                'reports_filed'    => $reportsFiled,
                'reports_against'  => $reportsAgainst,
                'referrals_count'  => $referralsCount,
            ],
            // DIRECT-mode advisory finance — no money moves, no balances/payouts.
            'finance'            => $finance,
            'created_at'         => $this->iso($user->created_at),
            'last_active_at'     => $this->iso($user->last_active_at),
        ];
    }

    private function recentBookings(User $user): array
    {
        return DB::table('bookings as b')
            ->leftJoin('services as s', 's.id', '=', 'b.service_id')
            ->where(fn ($q) => $q->where('b.buyer_id', $user->id)->orWhere('b.provider_id', $user->id))
            ->orderByDesc('b.created_at')
            ->limit(5)
            ->get(['b.id', 's.title as service_title', 'b.status', 'b.amount', 'b.agreed_amount', 'b.provider_id', 'b.created_at'])
            ->map(fn ($b) => [
                'id'            => $b->id,
                'service_title' => $b->service_title ?? 'Service',
                'status'        => $b->status,
                'amount'        => (float) ($b->agreed_amount ?? $b->amount ?? 0),
                'role'          => $b->provider_id === $user->id ? 'provider' : 'customer',
                'created_at'    => $this->iso($b->created_at),
            ])->all();
    }

    private function services(User $user): array
    {
        $items = DB::table('services')
            ->where('provider_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(10)
            ->get(['id', 'title', 'status'])
            ->map(fn ($s) => ['id' => $s->id, 'title' => $s->title, 'status' => $s->status])
            ->all();

        return [
            'count' => DB::table('services')->where('provider_id', $user->id)->count(),
            'items' => $items,
        ];
    }

    private function directFinance(User $user): array
    {
        $row = DB::table('commissions')
            ->where('provider_id', $user->id)
            ->selectRaw('COALESCE(SUM(gross_amount), 0) as gmv')
            ->selectRaw("COALESCE(SUM(CASE WHEN payment_mode = 'DIRECT' AND collection_status = 'UNCOLLECTED' THEN commission_amount ELSE 0 END), 0) as commission_due")
            ->first();

        return [
            'gmv'                       => (float) ($row->gmv ?? 0),
            'commission_due_uncollected'=> (float) ($row->commission_due ?? 0),
        ];
    }

    // ── Moderation (audited) ─────────────────────────────────────────────────────

    public function warn(User $user, AdminUser $actor, string $reason): array
    {
        $this->assertActionable($user);

        $this->audit->perform(
            actor: $actor,
            action: 'user.warn',
            targetType: 'user',
            targetId: $user->id,
            reason: $reason,
            metadata: ['before' => ['warned_at' => $this->iso($user->warned_at)], 'after' => ['warned' => true]],
            mutation: fn () => $user->forceFill(['warned_at' => now()])->save(),
        );

        $this->notifications->dispatch(new AccountModerated($user->id, 'warned', $reason));

        return $this->detail($user->fresh(), $actor);
    }

    public function suspend(User $user, AdminUser $actor, string $reason, ?int $durationDays): array
    {
        $this->assertActionable($user);
        if ($user->account_state === AccountState::SUSPENDED->value) {
            throw new ApiException(ErrorCode::CONFLICT, 'This account is already suspended.');
        }

        $until = $durationDays ? now()->addDays($durationDays) : null;

        $this->audit->perform(
            actor: $actor,
            action: 'user.suspend',
            targetType: 'user',
            targetId: $user->id,
            reason: $reason,
            metadata: [
                'before' => ['account_state' => $user->account_state],
                'after'  => ['account_state' => 'SUSPENDED', 'suspended_until' => $this->iso($until), 'duration_days' => $durationDays],
            ],
            mutation: fn () => $user->forceFill([
                'account_state'   => AccountState::SUSPENDED->value,
                'suspended_until' => $until,
            ])->save(),
        );

        // Immediate real-time effect: every active session is cut within seconds,
        // regardless of the JWT's remaining TTL — see EnsureAccountActive.
        $this->authService->invalidateAllSessions($user->id);

        $this->notifications->dispatch(new AccountModerated(
            $user->id,
            'suspended',
            $reason,
            $until?->toFormattedDateString(),
        ));

        return $this->detail($user->fresh(), $actor);
    }

    public function ban(User $user, AdminUser $actor, string $reason): array
    {
        if ($user->account_state === AccountState::BANNED->value) {
            throw new ApiException(ErrorCode::CONFLICT, 'This account is already banned.');
        }

        $profile = $user->providerProfile;

        $this->audit->perform(
            actor: $actor,
            action: 'user.ban',
            targetType: 'user',
            targetId: $user->id,
            reason: $reason,
            metadata: [
                'before' => ['account_state' => $user->account_state, 'trust_tier' => (int) ($profile?->trust_tier ?? 0)],
                'after'  => ['account_state' => 'BANNED', 'trust_tier' => 0],
            ],
            mutation: function () use ($user, $profile) {
                $user->forceFill([
                    'account_state'   => AccountState::BANNED->value,
                    'suspended_until' => null,
                ])->save();
                // §4.1 — tier resets to 0 on ban.
                if ($profile) {
                    $profile->forceFill(['trust_tier' => 0])->save();
                }
            },
        );

        // Immediate real-time effect: every active session is cut within seconds,
        // regardless of the JWT's remaining TTL — see EnsureAccountActive.
        $this->authService->invalidateAllSessions($user->id);

        $this->notifications->dispatch(new AccountModerated($user->id, 'banned', $reason));

        return $this->detail($user->fresh(), $actor);
    }

    public function reinstate(User $user, AdminUser $actor, string $reason): array
    {
        if ($user->account_state === AccountState::ACTIVE->value && $user->warned_at === null) {
            throw new ApiException(ErrorCode::CONFLICT, 'This account is already active with no active warning.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'user.reinstate',
            targetType: 'user',
            targetId: $user->id,
            reason: $reason,
            metadata: ['before' => ['account_state' => $user->account_state], 'after' => ['account_state' => 'ACTIVE']],
            mutation: fn () => $user->forceFill([
                'account_state'   => AccountState::ACTIVE->value,
                'warned_at'       => null,
                'suspended_until' => null,
            ])->save(),
        );

        $this->notifications->dispatch(new AccountModerated($user->id, 'reinstated', $reason));

        return $this->detail($user->fresh(), $actor);
    }

    public function adjustTier(User $user, AdminUser $actor, int $tier, string $reason): array
    {
        $profile = $user->providerProfile;
        if (!$profile) {
            throw new ApiException(ErrorCode::CONFLICT, 'This user is not a provider, so they have no tier to adjust.');
        }
        if ((int) $profile->trust_tier === $tier) {
            throw new ApiException(ErrorCode::CONFLICT, 'The provider is already at that tier.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'user.adjust_tier',
            targetType: 'user',
            targetId: $user->id,
            reason: $reason,
            metadata: ['before' => ['trust_tier' => (int) $profile->trust_tier], 'after' => ['trust_tier' => $tier]],
            mutation: fn () => $profile->forceFill(['trust_tier' => $tier])->save(),
        );

        return $this->detail($user->fresh(), $actor);
    }

    // ── Denylist (audited, hashed) ───────────────────────────────────────────────

    public function addToDenylist(User $user, AdminUser $actor, array $hashTypes, string $category, string $reason): array
    {
        $user->loadMissing('providerProfile');

        // Resolve each requested identifier kind to its raw value (skip missing).
        $resolved = [];
        foreach (array_unique($hashTypes) as $type) {
            $raw = match ($type) {
                'PHONE_HASH'       => $user->phone,
                'EMAIL_HASH'       => $user->email,
                'MOMO_NUMBER_HASH' => $user->providerProfile?->momo_number,
                default            => null,
            };
            if ($raw) {
                $resolved[$type] = $raw;
            }
        }

        if (empty($resolved)) {
            throw new ApiException(ErrorCode::CONFLICT, 'None of the selected identifiers are present on this account.');
        }

        $added = $this->audit->perform(
            actor: $actor,
            action: 'user.denylist_add',
            targetType: 'user',
            targetId: $user->id,
            reason: $reason,
            // metadata records WHICH identifier kinds were added — never the raw values or the hash.
            metadata: ['after' => ['hash_types' => array_keys($resolved), 'category' => $category]],
            mutation: function () use ($resolved, $category, $actor) {
                $count = 0;
                foreach ($resolved as $type => $raw) {
                    $hash = IdentifierHash::for($type, $raw);
                    // Idempotent — unique (hash_type, hash_value).
                    if (FraudDenylist::where('hash_type', $type)->where('hash_value', $hash)->exists()) {
                        continue;
                    }
                    FraudDenylist::create([
                        'hash_type'  => $type,
                        'hash_value' => $hash,
                        'reason'     => $category,
                        'added_by'   => $actor->id,
                        'added_at'   => now(),
                        'expires_at' => null, // permanent
                    ]);
                    $count++;
                }
                return $count;
            },
        );

        $detail = $this->detail($user->fresh(), $actor);
        $detail['denylist_added'] = $added;

        return $detail;
    }

    // ── PII reveal (gated + logged, not a mutation) ──────────────────────────────

    public function revealPii(User $user, AdminUser $actor): array
    {
        // The reveal itself is auditable: who unmasked which record, when, from where.
        $this->audit->log(
            actor: $actor,
            action: 'user.pii_access',
            targetType: 'user',
            targetId: $user->id,
            reason: 'Revealed contact / identity fields in the admin user detail view.',
        );

        $user->loadMissing('providerProfile');

        return [
            'email'      => $user->email,
            'phone'      => $user->phone,
            'legal_name' => $user->legal_name,
            'momo_number'=> $user->providerProfile?->momo_number,
        ];
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private function assertActionable(User $user): void
    {
        if ($user->account_state === AccountState::BANNED->value) {
            throw new ApiException(ErrorCode::CONFLICT, 'This account is banned. Reinstate it before applying other actions.');
        }
    }

    private function latestModerationReason(string $userId): ?string
    {
        $row = DB::table('admin_audit_log')
            ->where('target_type', 'user')
            ->where('target_id', $userId)
            ->whereIn('action', self::MODERATION_ACTIONS)
            ->orderByDesc('created_at')
            ->first(['reason']);

        return $row?->reason;
    }

    private function maskedContact(User $user): array
    {
        return [
            'has_email'         => (bool) $user->email,
            'has_phone'         => (bool) $user->phone,
            'has_legal_name'    => (bool) $user->legal_name,
            'email_masked'      => $this->maskEmail($user->email),
            'phone_masked'      => $this->maskPhone($user->phone),
            'legal_name_masked' => $this->maskName($user->legal_name),
        ];
    }

    private function maskEmail(?string $email): ?string
    {
        if (!$email || !str_contains($email, '@')) {
            return $email ? '•••' : null;
        }
        [$local, $domain] = explode('@', $email, 2);
        $head = mb_substr($local, 0, 1);
        return $head . str_repeat('•', max(3, mb_strlen($local) - 1)) . '@' . $domain;
    }

    private function maskPhone(?string $phone): ?string
    {
        if (!$phone) {
            return null;
        }
        $tail = mb_substr($phone, -3);
        return '••• ••• ' . $tail;
    }

    private function maskName(?string $name): ?string
    {
        if (!$name) {
            return null;
        }
        $parts = preg_split('/\s+/', trim($name));
        $first = $parts[0] ?? '';
        if (count($parts) === 1) {
            return mb_substr($first, 0, 1) . str_repeat('•', max(2, mb_strlen($first) - 1));
        }
        $lastInitial = mb_substr(end($parts), 0, 1);
        return $first . ' ' . $lastInitial . '•••';
    }

    private function displayName(?string $displayName, ?string $legalName, ?string $email): string
    {
        if ($displayName) return $displayName;
        if ($legalName)   return $legalName;
        if ($email)       return explode('@', $email)[0];
        return 'User';
    }

    private function roleLabel(?string $role, bool $isProvider): string
    {
        if (in_array($role, ['ADMIN', 'MODERATOR'], true)) {
            return 'staff';
        }
        if ($isProvider && $role === 'CUSTOMER') {
            return 'both';
        }
        return $isProvider ? 'provider' : 'customer';
    }

    private function accountStatus(?string $state, $warnedAt): string
    {
        return match ($state) {
            'BANNED'          => 'banned',
            'SUSPENDED'       => 'suspended',
            'RESTRICTED'      => 'restricted',
            'PENDING_CLOSURE' => 'pending_closure',
            default           => $warnedAt ? 'warned' : 'active',
        };
    }

    private function iso($value): ?string
    {
        if ($value === null) return null;
        return $value instanceof \DateTimeInterface
            ? $value->format(\DateTimeInterface::ATOM)
            : \Illuminate\Support\Carbon::parse($value)->toIso8601String();
    }
}
