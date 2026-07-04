<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Events\SafetyReportResolved;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\NotFoundException;
use App\Models\AdminUser;
use App\Models\EmergencyEvent;
use App\Models\SafetyReport;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Backend for the admin Safety module (UI: admin/src/components/safety).
 *
 * The highest-sensitivity surface in the panel. It triages two record kinds:
 *   - emergency_events (§11.4): an in-app emergency trigger. Always surfaced at
 *     the TOP of the queue, severity EMERGENCY, with a 2-hour outreach SLA.
 *   - safety_reports (§11.3): one-way reports. Severity HIGH or STANDARD.
 *
 * CONFIDENTIALITY (non-negotiable):
 *   - The reporter is the party in distress. Their identity is NEVER exposed to
 *     the reported party. Names/contact are MASKED in every list & detail
 *     response; raw values are only returned by revealPii(), which itself writes
 *     a PII-access audit entry (callers must hold safety.handle, route-gated).
 *   - Opening a detail (a sensitive-data read) is itself logged.
 *   - Case notes are internal — they live only in admin_audit_log.
 *   - This module RECORDS protective decisions (incl. authority escalation); it
 *     never contacts authorities itself. Suspending the reported user is a Users
 *     module action — the panel deep-links there rather than duplicating it.
 *
 * Every state change runs through AuditedMutationService so the mutation + audit
 * entry are written in one transaction.
 */
class AdminSafetyService
{
    private const OPEN_DISPUTE_STATES = ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE'];

    private const CATEGORY_LABELS = [
        'HARASSMENT'      => 'Harassment',
        'VIOLENCE_THREAT' => 'Violence or threat',
        'UNSAFE_BEHAVIOR' => 'Unsafe behaviour',
        'DISCRIMINATION'  => 'Discrimination',
        'STOLEN_PROPERTY' => 'Stolen property',
        'OTHER'           => 'Other',
    ];

    public function __construct(
        private readonly AuditedMutationService $audit,
        private readonly AdminUserService $users,
        private readonly NotificationDispatcher $notifications,
    ) {}

    // ── Queue (severity-first) ───────────────────────────────────────────────────

    public function queue(array $filters): array
    {
        $severity = $filters['severity'] ?? '';   // '' | EMERGENCY | HIGH | STANDARD
        $status   = $filters['status'] ?? '';     // '' | new | investigating | resolved
        $type     = $filters['type'] ?? '';       // '' | <category>
        $page     = max(1, (int) ($filters['page'] ?? 1));

        // Emergencies are surfaced as a distinct top band (never paginated away).
        // Hidden only when a non-emergency severity filter is active.
        $emergencies = ($severity === '' || $severity === 'EMERGENCY')
            ? $this->emergencyRows($status)
            : [];

        // Reports table (HIGH/STANDARD), severity-sorted then oldest-first.
        $reports = $this->reportQuery($severity, $status, $type)
            ->orderByRaw("CASE WHEN sr.severity = 'HIGH' THEN 0 ELSE 1 END")
            ->orderBy('sr.reported_at')
            ->paginate(20, ['*'], 'page', $page);

        return [
            'emergencies' => $emergencies,
            'data'        => collect($reports->items())->map(fn ($r) => $this->presentReportRow($r))->all(),
            'meta'        => [
                'current_page' => $reports->currentPage(),
                'last_page'    => $reports->lastPage(),
                'per_page'     => $reports->perPage(),
                'total'        => $reports->total(),
            ],
            'counts'      => [
                'emergencies_active' => EmergencyEvent::whereIn('status', ['ACTIVE', 'ACKNOWLEDGED'])->count(),
                'reports_open'       => SafetyReport::whereIn('status', ['OPEN', 'UNDER_REVIEW'])->count(),
            ],
        ];
    }

    private function reportQuery(string $severity, string $status, string $type)
    {
        $q = DB::table('safety_reports as sr')
            ->leftJoin('admin_users as au', 'au.id', '=', 'sr.assigned_admin_id')
            ->leftJoin('bookings as b', 'b.id', '=', 'sr.booking_id')
            ->select([
                'sr.id', 'sr.category', 'sr.severity', 'sr.status', 'sr.reported_at',
                'sr.reporter_id', 'sr.reported_id', 'sr.booking_id',
                'au.name as assigned_admin_name',
                'b.status as booking_status',
            ]);

        // Status: default to open work; "resolved" includes dismissed.
        match ($status) {
            'new'           => $q->where('sr.status', 'OPEN'),
            'investigating' => $q->where('sr.status', 'UNDER_REVIEW'),
            'resolved'      => $q->whereIn('sr.status', ['RESOLVED', 'DISMISSED']),
            default         => $q->whereIn('sr.status', ['OPEN', 'UNDER_REVIEW']),
        };

        if ($severity === 'HIGH' || $severity === 'STANDARD') {
            $q->where('sr.severity', $severity);
        }
        if ($type !== '') {
            $q->where('sr.category', $type);
        }

        return $q;
    }

    private function emergencyRows(string $status): array
    {
        $q = DB::table('emergency_events as ee')
            ->leftJoin('bookings as b', 'b.id', '=', 'ee.booking_id')
            ->select([
                'ee.id', 'ee.status', 'ee.created_at', 'ee.outreach_due_at', 'ee.location_label',
                'ee.triggered_by', 'ee.reported_id', 'ee.booking_id',
                'b.status as booking_status',
            ]);

        match ($status) {
            'new'           => $q->where('ee.status', 'ACTIVE'),
            'investigating' => $q->where('ee.status', 'ACKNOWLEDGED'),
            'resolved'      => $q->where('ee.status', 'RESOLVED'),
            default         => $q->whereIn('ee.status', ['ACTIVE', 'ACKNOWLEDGED']),
        };

        // Oldest first — the longest-running emergency is the most urgent.
        return $q->orderBy('ee.created_at')->limit(50)->get()
            ->map(fn ($e) => [
                'id'              => $e->id,
                'kind'            => 'emergency',
                'severity'        => 'EMERGENCY',
                'status'          => $this->normalizeStatus('emergency', $e->status),
                'reporter_masked' => $this->maskedLabel($e->triggered_by),
                'reported_masked' => $e->reported_id ? $this->maskedLabel($e->reported_id) : null,
                'booking'         => $e->booking_id ? ['id' => $e->booking_id, 'status' => $e->booking_status] : null,
                'location_label'  => $e->location_label,
                'created_at'      => $this->iso($e->created_at),
                'outreach_due_at' => $this->iso($e->outreach_due_at),
            ])->all();
    }

    private function presentReportRow(object $r): array
    {
        return [
            'id'                  => $r->id,
            'kind'                => 'report',
            'severity'            => $r->severity,
            'category'            => $r->category,
            'category_label'      => self::CATEGORY_LABELS[$r->category] ?? $r->category,
            'status'              => $this->normalizeStatus('report', $r->status),
            'reporter_masked'     => $this->maskedLabel($r->reporter_id),
            'reported_masked'     => $this->maskedLabel($r->reported_id),
            'booking'             => $r->booking_id ? ['id' => $r->booking_id, 'status' => $r->booking_status] : null,
            'assigned_admin_name' => $r->assigned_admin_name,
            'reported_at'         => $this->iso($r->reported_at),
        ];
    }

    // ── Detail (sensitive read — logged) ─────────────────────────────────────────

    public function detail(string $kind, string $id, AdminUser $actor): array
    {
        $detail = $kind === 'emergency'
            ? $this->emergencyDetail($id)
            : $this->reportDetail($id);

        // Opening a safety record is itself a sensitive-data access (§ reads logged).
        $this->audit->log(
            actor: $actor,
            action: 'safety.access',
            targetType: $kind === 'emergency' ? 'emergency_event' : 'safety_report',
            targetId: $id,
            reason: 'Opened the safety record in the admin triage detail view.',
        );

        return $detail;
    }

    private function reportDetail(string $id): array
    {
        $report = SafetyReport::find($id);
        if (! $report) {
            throw new NotFoundException('SafetyReport');
        }

        $assignedName = $report->assigned_admin_id
            ? DB::table('admin_users')->where('id', $report->assigned_admin_id)->value('name')
            : null;
        $reviewerName = $report->reviewed_by_admin_id
            ? DB::table('admin_users')->where('id', $report->reviewed_by_admin_id)->value('name')
            : null;

        return [
            'kind'                   => 'report',
            'id'                     => $report->id,
            'severity'               => $report->severity,
            'status'                 => $this->normalizeStatus('report', $report->status),
            'status_raw'             => $report->status,
            'category'               => $report->category,
            'category_label'         => self::CATEGORY_LABELS[$report->category] ?? $report->category,
            'description'            => $report->description,
            'reported_at'            => $this->iso($report->reported_at),
            'assigned'               => $report->assigned_admin_id
                ? ['admin_id' => $report->assigned_admin_id, 'admin_name' => $assignedName]
                : null,
            'contact_restricted'     => (bool) $report->contact_restricted,
            'account_restricted'     => (bool) $report->account_restricted,
            'authority_escalated_at' => $this->iso($report->authority_escalated_at),
            'super_admin_escalated'  => (bool) $report->super_admin_escalated,
            'outcome'                => $report->outcome,
            'review_notes'           => $report->review_notes,
            'reviewed_at'            => $this->iso($report->reviewed_at),
            'reviewed_by_admin_name' => $reviewerName,
            'reporter'               => $this->party($report->reporter_id, isReporter: true),
            'reported'               => $report->reported_id ? $this->party($report->reported_id, isReporter: false) : null,
            'booking'                => $this->bookingBlock($report->booking_id),
        ];
    }

    private function emergencyDetail(string $id): array
    {
        $event = EmergencyEvent::find($id);
        if (! $event) {
            throw new NotFoundException('EmergencyEvent');
        }

        $assignedName = $event->assigned_admin_id
            ? DB::table('admin_users')->where('id', $event->assigned_admin_id)->value('name')
            : null;
        $resolverName = $event->resolved_by_admin_id
            ? DB::table('admin_users')->where('id', $event->resolved_by_admin_id)->value('name')
            : null;

        return [
            'kind'                   => 'emergency',
            'id'                     => $event->id,
            'severity'               => 'EMERGENCY',
            'status'                 => $this->normalizeStatus('emergency', $event->status),
            'status_raw'             => $event->status,
            'location_label'         => $event->location_label,
            'created_at'             => $this->iso($event->created_at),
            'outreach_due_at'        => $this->iso($event->outreach_due_at),
            'assigned'               => $event->assigned_admin_id
                ? ['admin_id' => $event->assigned_admin_id, 'admin_name' => $assignedName]
                : null,
            'outcome'                => $event->outcome,
            'resolved_at'            => $this->iso($event->resolved_at),
            'reviewed_by_admin_name' => $resolverName,
            'reporter'               => $this->party($event->triggered_by, isReporter: true),
            'reported'               => $event->reported_id ? $this->party($event->reported_id, isReporter: false) : null,
            'booking'                => $this->bookingBlock($event->booking_id),
        ];
    }

    /** Masked party block: identity stays masked here; raw via revealPii(). */
    private function party(string $userId, bool $isReporter): ?array
    {
        $u = DB::table('users as u')
            ->leftJoin('provider_profiles as pp', 'pp.user_id', '=', 'u.id')
            ->where('u.id', $userId)
            ->select(['u.id', 'u.role', 'u.account_state', 'u.warned_at', 'u.legal_name', 'u.email', 'u.phone', 'pp.display_name'])
            ->first();

        if (! $u) {
            return null;
        }

        return [
            'user_id'        => $u->id,
            'is_reporter'    => $isReporter,
            'display_masked' => $this->maskName($u->display_name ?? $u->legal_name ?? $this->localPart($u->email)),
            'role_label'     => $this->roleLabel($u->role),
            'account_status' => $this->accountStatus($u->account_state, $u->warned_at),
            'contact'        => [
                'has_email'         => (bool) $u->email,
                'has_phone'         => (bool) $u->phone,
                'has_legal_name'    => (bool) $u->legal_name,
                'email_masked'      => $this->maskEmail($u->email),
                'phone_masked'      => $this->maskPhone($u->phone),
                'legal_name_masked' => $this->maskName($u->legal_name),
            ],
            'history'        => [
                'reports_against' => DB::table('safety_reports')->where('reported_id', $u->id)->count(),
                'reports_filed'   => DB::table('safety_reports')->where('reporter_id', $u->id)->count(),
                'open_disputes'   => DB::table('disputes')->where('against', $u->id)->whereIn('status', self::OPEN_DISPUTE_STATES)->count(),
            ],
        ];
    }

    private function bookingBlock(?string $bookingId): ?array
    {
        if (! $bookingId) {
            return null;
        }

        $b = DB::table('bookings as b')
            ->leftJoin('services as s', 's.id', '=', 'b.service_id')
            ->where('b.id', $bookingId)
            ->select([
                'b.id', 'b.status', 'b.scheduled_start', 'b.amount', 'b.agreed_amount',
                'b.delivery_location_label', 'b.delivery_location_region', 's.title as service_title',
            ])
            ->first();

        if (! $b) {
            return null;
        }

        return [
            'id'              => $b->id,
            'status'          => $b->status,
            'service_title'   => $b->service_title ?? 'Service',
            'scheduled_start' => $this->iso($b->scheduled_start),
            'amount'          => (float) ($b->agreed_amount ?? $b->amount ?? 0),
            'location_label'  => $b->delivery_location_label,
            'location_region' => $b->delivery_location_region,
        ];
    }

    // ── PII reveal (gated + logged, not a mutation) ──────────────────────────────

    public function revealPii(string $kind, string $id, AdminUser $actor): array
    {
        [$reporterId, $reportedId] = $this->partyIds($kind, $id);

        $this->audit->log(
            actor: $actor,
            action: 'safety.pii_access',
            targetType: $kind === 'emergency' ? 'emergency_event' : 'safety_report',
            targetId: $id,
            reason: 'Revealed contact / identity of the parties in the safety detail view.',
        );

        return [
            'reporter' => $this->rawContact($reporterId),
            'reported' => $reportedId ? $this->rawContact($reportedId) : null,
        ];
    }

    private function rawContact(string $userId): array
    {
        $u = DB::table('users')->where('id', $userId)->first(['email', 'phone', 'legal_name']);

        return [
            'email'      => $u->email ?? null,
            'phone'      => $u->phone ?? null,
            'legal_name' => $u->legal_name ?? null,
        ];
    }

    // ── Actions (audited) ────────────────────────────────────────────────────────

    /** Claim → "investigating by {admin}". Idempotent reassignment. */
    public function claim(string $kind, string $id, AdminUser $actor, string $reason): array
    {
        $record = $this->find($kind, $id);

        $this->audit->perform(
            actor: $actor,
            action: 'safety.claim',
            targetType: $this->targetType($kind),
            targetId: $id,
            reason: $reason,
            metadata: ['after' => ['assigned_admin_id' => $actor->id]],
            mutation: function () use ($record, $kind, $actor) {
                if ($kind === 'emergency') {
                    $record->forceFill([
                        'assigned_admin_id' => $actor->id,
                        'acknowledged_at'   => now(),
                        'status'            => $record->status === 'ACTIVE' ? 'ACKNOWLEDGED' : $record->status,
                    ])->save();
                } else {
                    $record->forceFill([
                        'assigned_admin_id' => $actor->id,
                        'assigned_at'       => now(),
                        'status'            => $record->status === 'OPEN' ? 'UNDER_REVIEW' : $record->status,
                    ])->save();
                }
            },
        );

        return $this->detail($kind, $id, $actor);
    }

    /** Internal case note — append-only, lives in admin_audit_log. Not a mutation. */
    public function addNote(string $kind, string $id, AdminUser $actor, string $note): array
    {
        $this->find($kind, $id); // 404 if missing

        $this->audit->log(
            actor: $actor,
            action: 'safety.note',
            targetType: $this->targetType($kind),
            targetId: $id,
            reason: $note,
        );

        return $this->detail($kind, $id, $actor);
    }

    /** Protective: restrict contact between the two parties. */
    public function restrictContact(string $kind, string $id, AdminUser $actor, string $reason): array
    {
        $record = $this->find($kind, $id);

        if ($kind === 'emergency') {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Contact restriction applies to safety reports. Acknowledge and resolve the emergency, or restrict the user from the Users module.');
        }
        if ($record->contact_restricted) {
            throw new ApiException(ErrorCode::CONFLICT, 'Contact between these parties is already restricted.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'safety.restrict_contact',
            targetType: 'safety_report',
            targetId: $id,
            reason: $reason,
            metadata: ['after' => ['contact_restricted' => true]],
            mutation: fn () => $record->forceFill(['contact_restricted' => true])->save(),
        );

        return $this->detail($kind, $id, $actor);
    }

    /**
     * Suspend the reported user as a result of this report. The account
     * mutation itself is NOT duplicated here — it calls straight into the
     * Users module (single source of truth), then records the link against
     * the safety report so both modules carry an audit entry for it.
     */
    public function restrictReportedUser(string $kind, string $id, AdminUser $actor, string $reason, ?int $suspendDurationDays = null): array
    {
        if ($kind !== 'report') {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Restricting the reported user is recorded against a safety report.');
        }

        /** @var SafetyReport $record */
        $record = $this->find($kind, $id);
        if (! $record->reported_id) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'This report has no identified reported user to restrict.');
        }
        if ($record->account_restricted) {
            throw new ApiException(ErrorCode::CONFLICT, 'The reported user has already been restricted from this report.');
        }

        $reportedUser = User::findOrFail($record->reported_id);

        // Users.suspend() writes its own 'user.suspend' audit entry, invalidates
        // the reported user's sessions immediately, and sends them the account
        // notification — none of that is duplicated here.
        $this->users->suspend($reportedUser, $actor, $reason, $suspendDurationDays);

        $this->audit->perform(
            actor: $actor,
            action: 'safety.restrict_reported_user',
            targetType: 'safety_report',
            targetId: $id,
            reason: $reason,
            metadata: ['after' => ['account_restricted' => true, 'restricted_user_id' => $reportedUser->id]],
            mutation: fn () => $record->forceFill(['account_restricted' => true])->save(),
        );

        return $this->detail($kind, $id, $actor);
    }

    /**
     * Record a decision to escalate to authorities. The platform does NOT contact
     * authorities itself — this only records that the admin decided to.
     */
    public function escalateAuthority(string $kind, string $id, AdminUser $actor, string $reason): array
    {
        $record = $this->find($kind, $id);
        if ($kind !== 'report') {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Authority escalation is recorded against a safety report.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'safety.escalate_authority',
            targetType: 'safety_report',
            targetId: $id,
            reason: $reason,
            metadata: ['after' => ['authority_escalated' => true]],
            mutation: fn () => $record->forceFill(['authority_escalated_at' => now()])->save(),
        );

        return $this->detail($kind, $id, $actor);
    }

    /** Escalate the report to super_admin for sign-off. */
    public function escalateSuperAdmin(string $kind, string $id, AdminUser $actor, string $reason): array
    {
        $record = $this->find($kind, $id);
        if ($kind !== 'report') {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Super-admin escalation is recorded against a safety report.');
        }
        if ($record->super_admin_escalated) {
            throw new ApiException(ErrorCode::CONFLICT, 'This report is already escalated to a super admin.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'safety.escalate_super_admin',
            targetType: 'safety_report',
            targetId: $id,
            reason: $reason,
            metadata: ['after' => ['super_admin_escalated' => true]],
            mutation: fn () => $record->forceFill(['super_admin_escalated' => true])->save(),
        );

        return $this->detail($kind, $id, $actor);
    }

    /** Resolve with an outcome + reason. */
    public function resolve(string $kind, string $id, AdminUser $actor, string $outcome, string $reason): array
    {
        $record = $this->find($kind, $id);

        if ($kind === 'emergency') {
            if ($record->status === 'RESOLVED') {
                throw new ApiException(ErrorCode::CONFLICT, 'This emergency is already resolved.');
            }
        } else {
            if (! in_array($record->status, ['OPEN', 'UNDER_REVIEW'], true)) {
                throw new ApiException(ErrorCode::CONFLICT, 'This report is already closed.');
            }
        }

        $this->audit->perform(
            actor: $actor,
            action: 'safety.resolve',
            targetType: $this->targetType($kind),
            targetId: $id,
            reason: $reason,
            metadata: ['after' => ['status' => 'RESOLVED', 'outcome' => $outcome]],
            mutation: function () use ($record, $kind, $actor, $outcome, $reason) {
                if ($kind === 'emergency') {
                    $record->forceFill([
                        'status'               => 'RESOLVED',
                        'outcome'              => $outcome,
                        'resolved_by_admin_id' => $actor->id,
                        'resolved_at'          => now(),
                    ])->save();
                } else {
                    $record->forceFill([
                        'status'               => 'RESOLVED',
                        'outcome'              => $outcome,
                        'reviewed_by_admin_id' => $actor->id,
                        'review_notes'         => $reason,
                        'reviewed_at'          => now(),
                    ])->save();
                }
            },
        );

        // Reporter-only, generic notice — outcome, review notes and the
        // reported party's identity are never included (§ confidentiality).
        $reporterId = $kind === 'emergency' ? $record->triggered_by : $record->reporter_id;
        if ($reporterId) {
            $this->notifications->dispatch(new SafetyReportResolved($reporterId, $kind));
        }

        return $this->detail($kind, $id, $actor);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private function find(string $kind, string $id): SafetyReport|EmergencyEvent
    {
        $record = $kind === 'emergency' ? EmergencyEvent::find($id) : SafetyReport::find($id);
        if (! $record) {
            throw new NotFoundException($kind === 'emergency' ? 'EmergencyEvent' : 'SafetyReport');
        }
        return $record;
    }

    private function partyIds(string $kind, string $id): array
    {
        $record = $this->find($kind, $id);
        return $kind === 'emergency'
            ? [$record->triggered_by, $record->reported_id]
            : [$record->reporter_id, $record->reported_id];
    }

    private function targetType(string $kind): string
    {
        return $kind === 'emergency' ? 'emergency_event' : 'safety_report';
    }

    private function normalizeStatus(string $kind, string $raw): string
    {
        if ($kind === 'emergency') {
            return match ($raw) {
                'ACTIVE'       => 'new',
                'ACKNOWLEDGED' => 'investigating',
                'RESOLVED'     => 'resolved',
                default        => 'new',
            };
        }
        return match ($raw) {
            'OPEN'                  => 'new',
            'UNDER_REVIEW'          => 'investigating',
            'RESOLVED', 'DISMISSED' => 'resolved',
            default                 => 'new',
        };
    }

    private function maskedLabel(?string $userId): ?string
    {
        if (! $userId) {
            return null;
        }
        $u = DB::table('users as u')
            ->leftJoin('provider_profiles as pp', 'pp.user_id', '=', 'u.id')
            ->where('u.id', $userId)
            ->first(['u.legal_name', 'u.email', 'pp.display_name']);

        if (! $u) {
            return null;
        }
        return $this->maskName($u->display_name ?? $u->legal_name ?? $this->localPart($u->email));
    }

    private function localPart(?string $email): ?string
    {
        if (! $email) {
            return null;
        }
        return explode('@', $email)[0];
    }

    private function roleLabel(?string $role): string
    {
        return match ($role) {
            'PROVIDER'          => 'Provider',
            'ADMIN', 'MODERATOR'=> 'Staff',
            default             => 'Customer',
        };
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

    private function maskEmail(?string $email): ?string
    {
        if (! $email || ! str_contains($email, '@')) {
            return $email ? '•••' : null;
        }
        [$local, $domain] = explode('@', $email, 2);
        return mb_substr($local, 0, 1) . str_repeat('•', max(3, mb_strlen($local) - 1)) . '@' . $domain;
    }

    private function maskPhone(?string $phone): ?string
    {
        if (! $phone) {
            return null;
        }
        return '••• ••• ' . mb_substr($phone, -3);
    }

    private function maskName(?string $name): ?string
    {
        if (! $name) {
            return null;
        }
        $parts = preg_split('/\s+/', trim($name));
        $first = $parts[0] ?? '';
        if (count($parts) === 1) {
            return mb_substr($first, 0, 1) . str_repeat('•', max(2, mb_strlen($first) - 1));
        }
        return $first . ' ' . mb_substr(end($parts), 0, 1) . '•••';
    }

    private function iso($value): ?string
    {
        if ($value === null) {
            return null;
        }
        return $value instanceof \DateTimeInterface
            ? $value->format(\DateTimeInterface::ATOM)
            : Carbon::parse($value)->toIso8601String();
    }
}
