<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\AuditedMutationService;
use App\Support\AdminCapabilities;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Read-only admin audit log (consumed by admin/src/components/ui/AuditTrail.tsx).
 *
 * Access model: holders of `read:audit` may browse the whole log. Other admins
 * (e.g. trust_safety reviewers) may only read the trail SCOPED to a specific
 * record — so they can see a submission's decision history inside the drawer
 * without being able to browse platform-wide audit data.
 */
class AdminAuditLogController extends Controller
{
    public function __construct(private readonly AuditedMutationService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $admin     = $request->user();
        $targetId  = $request->string('target_id')->toString();
        $canBrowse = AdminCapabilities::roleHas($admin->role, 'read:audit');

        if (! $canBrowse && $targetId === '') {
            abort(403, 'You may only view the audit trail for a specific record.');
        }

        $paginator = $this->audit->query([
            'actor'       => $request->string('actor')->toString(),
            'action'      => $request->string('action')->toString(),
            'target_type' => $request->string('target_type')->toString(),
            'target_id'   => $targetId,
            'search'      => $request->string('search')->toString(),
        ], 30);

        $data = collect($paginator->items())->map(function ($row) {
            $metadata = is_string($row->metadata) ? json_decode($row->metadata, true) : ($row->metadata ?? []);

            return [
                'id'             => $row->id,
                'actor_admin_id' => $row->actor_admin_id,
                'actor_name'     => $row->actor_name,
                'actor_role'     => $row->actor_role,
                'action'         => $row->action,
                'target_type'    => $row->target_type,
                'target_id'      => $row->target_id,
                'reason'         => $row->reason,
                'metadata'       => $metadata ?: new \stdClass(),
                'ip'             => $row->ip,
                'user_agent'     => $row->user_agent,
                'created_at'     => $row->created_at,
            ];
        })->all();

        return response()->json([
            'data' => $data,
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page'    => $paginator->lastPage(),
                'per_page'     => $paginator->perPage(),
                'total'        => $paginator->total(),
            ],
        ]);
    }
}
