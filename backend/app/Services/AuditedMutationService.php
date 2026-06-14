<?php

namespace App\Services;

use App\Models\AdminUser;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * AuditedMutationService — the ONLY sanctioned way to perform a sensitive
 * state-changing admin operation.
 *
 * It guarantees that:
 *   1. The business mutation and the audit log entry are written in the same
 *      database transaction — no "log and forget" or "forgot to log" scenarios.
 *   2. A non-empty reason is always present before any mutation runs.
 *   3. PII is never written to the audit metadata (caller's responsibility to
 *      scrub the before/after snapshots).
 *
 * Usage example:
 *
 *   $auditService->perform(
 *       actor: $request->user(),
 *       action: 'user.ban',
 *       targetType: 'user',
 *       targetId: $targetUser->id,
 *       reason: $request->input('reason'),
 *       metadata: ['before' => ['account_state' => $targetUser->account_state]],
 *       mutation: function () use ($targetUser) {
 *           $targetUser->update(['account_state' => 'BANNED']);
 *           // Add to denylist, notify, etc.
 *       }
 *   );
 */
class AuditedMutationService
{
    /**
     * Execute $mutation and write an audit entry in the same transaction.
     *
     * @template T
     * @param  AdminUser $actor     The admin performing the action.
     * @param  string   $action     Dot-notation action name, e.g. "user.ban".
     * @param  string   $targetType Domain object type, e.g. "user".
     * @param  string   $targetId   UUID of the affected record.
     * @param  string   $reason     Free-text reason (required, min 10 chars enforced here).
     * @param  array    $metadata   { before: [...], after: [...] } — PII must be scrubbed by caller.
     * @param  callable $mutation   The state-changing operation. Return value is passed through.
     * @return T
     * @throws \InvalidArgumentException if reason is blank or too short.
     * @throws Throwable re-throws any exception from $mutation after rolling back.
     */
    public function perform(
        AdminUser $actor,
        string $action,
        string $targetType,
        string $targetId,
        string $reason,
        array $metadata,
        callable $mutation,
    ): mixed {
        $reason = trim($reason);
        if (strlen($reason) < 10) {
            throw new \InvalidArgumentException('Audit reason must be at least 10 characters.');
        }

        return DB::transaction(function () use (
            $actor, $action, $targetType, $targetId, $reason, $metadata, $mutation
        ) {
            // 1. Execute the business mutation first so any exception rolls back cleanly
            $result = $mutation();

            // 2. Write the audit entry in the same transaction
            DB::table('admin_audit_log')->insert([
                'id'             => Str::uuid()->toString(),
                'actor_admin_id' => $actor->id,
                'actor_role'     => $actor->role ?? 'unknown',
                'action'         => $action,
                'target_type'    => $targetType,
                'target_id'      => $targetId,
                'reason'         => $reason,
                'metadata'       => json_encode($metadata, JSON_THROW_ON_ERROR),
                'ip'             => request()->ip() ?? '0.0.0.0',
                'user_agent'     => substr(request()->userAgent() ?? '', 0, 500),
                'created_at'     => now(),
            ]);

            return $result;
        });
    }

    /**
     * Read-only: fetch paginated audit entries with optional filters.
     * Usable by the /api/admin/audit-log endpoint.
     */
    public function query(array $filters = [], int $perPage = 30): \Illuminate\Pagination\LengthAwarePaginator
    {
        $q = DB::table('admin_audit_log as a')
            ->join('admin_users as u', 'u.id', '=', 'a.actor_admin_id')
            ->select(
                'a.id', 'a.actor_admin_id', 'u.name as actor_name', 'a.actor_role',
                'a.action', 'a.target_type', 'a.target_id',
                'a.reason', 'a.metadata', 'a.ip', 'a.user_agent', 'a.created_at',
            )
            ->orderByDesc('a.created_at');

        if (!empty($filters['actor'])) {
            $q->where('a.actor_admin_id', $filters['actor']);
        }
        if (!empty($filters['action'])) {
            $q->where('a.action', $filters['action']);
        }
        if (!empty($filters['target_type'])) {
            $q->where('a.target_type', $filters['target_type']);
        }
        if (!empty($filters['target_id'])) {
            $q->where('a.target_id', $filters['target_id']);
        }
        if (!empty($filters['search'])) {
            $q->where(function ($inner) use ($filters) {
                $inner->where('a.action', 'ilike', '%' . $filters['search'] . '%')
                      ->orWhere('a.reason', 'ilike', '%' . $filters['search'] . '%')
                      ->orWhere('a.target_id', 'ilike', '%' . $filters['search'] . '%');
            });
        }
        if (!empty($filters['date_from'])) {
            $q->where('a.created_at', '>=', $filters['date_from']);
        }
        if (!empty($filters['date_to'])) {
            $q->where('a.created_at', '<=', $filters['date_to']);
        }

        return $q->paginate($perPage);
    }
}
