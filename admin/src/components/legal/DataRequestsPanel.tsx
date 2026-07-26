'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { toast } from '@/lib/store/toast-store'
import { legalAdminApi, type DataSubjectRequestRow } from '@/lib/api/legal'
import { IoShieldCheckmarkOutline } from 'react-icons/io5'

// Data-subject-rights queue (Data Protection Act No. 3 of 2021). Requests are
// captured from the app; staff advance their status here. Actual fulfilment
// (export/erasure) is performed out of band — this tracks the request lifecycle.
const STATUS_VARIANT: Record<string, 'pending' | 'info' | 'active' | 'danger'> = {
  RECEIVED: 'pending', IN_PROGRESS: 'info', COMPLETED: 'active', REJECTED: 'danger',
}
const NEXT_STATUSES = ['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED']

export function DataRequestsPanel() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('')

  const { data, isLoading } = useQuery({
    queryKey: ['legal-data-requests', statusFilter],
    queryFn: () => legalAdminApi.dataRequests(statusFilter ? { status: statusFilter } : undefined),
  })

  const requests = data?.data.requests ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500">Status</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-sm border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800">
          <option value="">All</option>
          {NEXT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
      ) : requests.length === 0 ? (
        <EmptyState icon={IoShieldCheckmarkOutline} title="No data-subject requests"
          description="Access, export, correction, objection and erasure requests from users will appear here." />
      ) : (
        <div className="overflow-hidden rounded-sm border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800/50">
              <tr>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Requested</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {requests.map((r) => (
                <RequestRow key={r.id} req={r} onDone={() => qc.invalidateQueries({ queryKey: ['legal-data-requests'] })} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RequestRow({ req, onDone }: { req: DataSubjectRequestRow; onDone: () => void }) {
  const [target, setTarget] = useState<string>(req.status)

  const mutate = useAuditedMutation<{ status: string }, unknown>({
    mutationFn: (payload) =>
      legalAdminApi.updateDataRequest(req.id, { status: payload.status, reason: payload.reason }),
    audit: {
      action: 'legal.data_request.update',
      targetType: 'data_subject_request',
      targetId: req.id,
      summary: `Update data request (${req.type}) status.`,
    },
    capability: 'legal.manage',
    onSuccess: () => { toast.success('Request updated.'); onDone() },
  })

  return (
    <tr className="text-slate-700 dark:text-slate-300">
      <td className="px-3 py-2 font-medium">{req.type}</td>
      <td className="px-3 py-2 font-mono text-xs">{req.user_phone ?? req.user_id.slice(0, 8)}</td>
      <td className="px-3 py-2 text-xs text-slate-500">{new Date(req.created_at).toLocaleDateString()}</td>
      <td className="px-3 py-2"><StatusPill label={req.status} variant={STATUS_VARIANT[req.status] ?? 'neutral'} autoVariant={false} /></td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <select value={target} onChange={(e) => setTarget(e.target.value)}
            className="rounded-sm border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800">
            {NEXT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" disabled={target === req.status || mutate.isPending}
            onClick={() => mutate.trigger({ status: target })}
            className="rounded-sm bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-700">
            Apply
          </button>
        </div>
      </td>
    </tr>
  )
}
