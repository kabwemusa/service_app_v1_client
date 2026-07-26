'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { IoAddOutline, IoPlayOutline, IoPauseOutline, IoStopOutline } from 'react-icons/io5'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { fmtZMW, fmtDate } from '@/lib/utils'
import {
  promotionsApi,
  type CampaignRow,
  type CampaignStatus,
  AUDIENCE_FILTER_LABELS,
} from '@/lib/api/promotions'
import { CampaignComposer } from '@/components/promotions/CampaignComposer'

const STATUS_OPTIONS = [
  { value: 'LIVE', label: 'Live' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ENDED', label: 'Ended' },
  { value: 'BUDGET_EXHAUSTED', label: 'Budget exhausted' },
]

function spendLabel(m: CampaignRow['metrics']): string {
  if (m.budget_cap === null) return `${fmtZMW(m.spend)} · uncapped`
  return `${fmtZMW(m.spend)} / ${fmtZMW(m.budget_cap)}`
}

/** Reused by the promo-codes tab (kind='code') for the code-based list. */
export function PromotionsCampaignsTab({ kind = 'campaign' }: { kind?: 'campaign' | 'code' }) {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<CampaignStatus | ''>('')
  const [composerOpen, setComposerOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['promotions-campaigns', kind, page, status],
    queryFn: () => promotionsApi.campaigns({ page, status: status || undefined, kind }),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['promotions-campaigns'] })
    queryClient.invalidateQueries({ queryKey: ['promotions-overview'] })
  }

  const launch = useAuditedMutation<{ id: string }, unknown>({
    capability: 'write:promotions',
    audit: { action: 'promotion.launch', targetType: 'campaign', targetId: '', summary: 'Make this campaign live — it will start rendering in the app and applying discounts.' },
    mutationFn: (p) => promotionsApi.launch(p.id, { reason: p.reason }),
    onSuccess: invalidate,
  })
  const pause = useAuditedMutation<{ id: string }, unknown>({
    capability: 'write:promotions',
    audit: { action: 'promotion.pause', targetType: 'campaign', targetId: '', summary: 'Pause this campaign — it stops rendering and applying in the app immediately.' },
    mutationFn: (p) => promotionsApi.pause(p.id, { reason: p.reason }),
    onSuccess: invalidate,
  })
  const end = useAuditedMutation<{ id: string }, unknown>({
    capability: 'write:promotions',
    audit: { action: 'promotion.end', targetType: 'campaign', targetId: '', summary: 'End this campaign permanently. This cannot be undone.' },
    mutationFn: (p) => promotionsApi.end(p.id, { reason: p.reason }),
    onSuccess: invalidate,
  })

  const columns = useMemo<ColumnDef<CampaignRow>[]>(() => [
    { accessorKey: 'name', header: 'Name' },
    {
      accessorKey: 'audience_filter',
      header: 'Audience',
      cell: ({ row }) => (
        <span className="text-slate-600 dark:text-slate-300">
          {row.original.audience_type === 'PROVIDER' ? 'Providers · ' : ''}
          {AUDIENCE_FILTER_LABELS[row.original.audience_filter] ?? row.original.audience_filter}
        </span>
      ),
    },
    {
      id: 'placements',
      header: 'Placements',
      cell: ({ row }) => (
        <span className="text-xs text-slate-500">{row.original.placements.map((p) => p.replace('APP_', '')).join(', ') || '—'}</span>
      ),
    },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusPill label={row.original.status.replace('_', ' ')} /> },
    { id: 'redemptions', header: 'Redemptions', cell: ({ row }) => row.original.metrics.redemptions },
    { id: 'spend', header: 'Spend / budget', cell: ({ row }) => <span className="text-xs">{spendLabel(row.original.metrics)}</span> },
    { id: 'bookings', header: 'Bookings', cell: ({ row }) => row.original.metrics.bookings_driven },
    { accessorKey: 'end_at', header: 'Ends', cell: ({ row }) => (row.original.end_at ? fmtDate(row.original.end_at) : '—') },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const s = row.original.status
        const canLaunch = ['DRAFT', 'SCHEDULED', 'PAUSED'].includes(s)
        const canPause = s === 'LIVE'
        const canEnd = !['ENDED'].includes(s)
        return (
          <Can do="write:promotions">
            <div className="flex items-center gap-2">
              {canLaunch && (
                <button type="button" disabled={launch.isPending} onClick={() => launch.trigger({ id: row.original.id })} className="flex items-center gap-1 text-xs font-medium text-teal-600 hover:underline disabled:opacity-50">
                  <IoPlayOutline className="size-3.5" /> Launch
                </button>
              )}
              {canPause && (
                <button type="button" disabled={pause.isPending} onClick={() => pause.trigger({ id: row.original.id })} className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:underline disabled:opacity-50">
                  <IoPauseOutline className="size-3.5" /> Pause
                </button>
              )}
              {canEnd && (
                <button type="button" disabled={end.isPending} onClick={() => end.trigger({ id: row.original.id })} className="flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-50">
                  <IoStopOutline className="size-3.5" /> End
                </button>
              )}
            </div>
          </Can>
        )
      },
    },
  ], [launch, pause, end])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <FilterBar
          filters={[
            { key: 'status', label: 'All statuses', value: status, options: STATUS_OPTIONS, onChange: (v) => { setStatus(v as CampaignStatus | ''); setPage(1) } },
          ]}
        />
        <Can do="write:promotions">
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-sm bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            <IoAddOutline className="size-4" /> {kind === 'code' ? 'New promo code' : 'New campaign'}
          </button>
        </Can>
      </div>

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage={kind === 'code' ? 'No promo codes yet' : 'No campaigns yet'}
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />

      <CampaignComposer open={composerOpen} onClose={() => setComposerOpen(false)} mode={kind} />
    </div>
  )
}
