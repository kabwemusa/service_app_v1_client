'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { IoWarningOutline, IoSyncOutline } from 'react-icons/io5'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { fmtZMW, fmtDatetime } from '@/lib/utils'
import { financeApi, type EscrowRow, type PawapayEventType } from '@/lib/api/finance'
import { useAdminChannel } from '@/lib/realtime/useAdminChannel'

const TYPE_OPTIONS = [
  { value: 'collection', label: 'Collection' },
  { value: 'payout', label: 'Payout' },
  { value: 'refund', label: 'Refund' },
]

const MATCH_VARIANT: Record<EscrowRow['match'], 'active' | 'danger' | 'pending'> = {
  MATCHED: 'active',
  MISMATCH: 'danger',
  PENDING: 'pending',
}

export function FinanceEscrowTab() {
  const [page, setPage] = useState(1)
  const [type, setType] = useState<PawapayEventType | ''>('')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['finance-escrow', page, type],
    queryFn: () => financeApi.escrow({ page, type: type || undefined }),
  })

  // Real-time: the same booking-lifecycle events PawaPay callbacks drive
  // (funds_held/disbursed/cancelled) — no polling.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['finance-escrow'] })
  useAdminChannel('finance', {
    'booking.funds_held': refresh,
    'booking.disbursed': refresh,
    'booking.cancelled': refresh,
  })

  const mismatchCount = (data?.data ?? []).filter((r) => r.match === 'MISMATCH').length

  const columns = useMemo<ColumnDef<EscrowRow>[]>(() => [
    { accessorKey: 'match', header: 'Match', cell: ({ row }) => (
      <StatusPill label={row.original.match} variant={MATCH_VARIANT[row.original.match]} autoVariant={false} />
    ) },
    { accessorKey: 'booking_id', header: 'Booking', cell: ({ row }) => (
      row.original.booking_id
        ? <span className="font-mono text-xs text-slate-500">{row.original.booking_id.slice(0, 8)}…</span>
        : <span className="text-xs text-slate-400">Unlinked</span>
    ) },
    { accessorKey: 'external_ref', header: 'PawaPay reference', cell: ({ row }) => (
      <span className="font-mono text-xs text-slate-500">{row.original.external_ref}</span>
    ) },
    { accessorKey: 'type', header: 'Type', cell: ({ row }) => <span className="capitalize">{row.original.type}</span> },
    { accessorKey: 'amount', header: 'Amount', cell: ({ row }) => row.original.amount !== null ? fmtZMW(row.original.amount) : '—' },
    { accessorKey: 'mno', header: 'MNO', cell: ({ row }) => row.original.mno ?? '—' },
    { accessorKey: 'pawapay_status', header: 'PawaPay status', cell: ({ row }) => <StatusPill label={row.original.pawapay_status} autoVariant /> },
    { accessorKey: 'booking_status', header: 'Booking status', cell: ({ row }) => row.original.booking_status ? <StatusPill label={row.original.booking_status} autoVariant /> : '—' },
    { accessorKey: 'created_at', header: 'Time', cell: ({ row }) => fmtDatetime(row.original.created_at) },
  ], [])

  return (
    <div className="space-y-4">
      {mismatchCount > 0 && (
        <div className="flex items-center gap-2 rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <IoWarningOutline className="size-4 shrink-0" />
          <span><strong>{mismatchCount}</strong> event{mismatchCount === 1 ? '' : 's'} on this page need manual resolution — PawaPay's status doesn't line up with the booking's state.</span>
        </div>
      )}

      <FilterBar
        filters={[
          { key: 'type', label: 'All types', value: type, options: TYPE_OPTIONS, onChange: (v) => { setType(v as PawapayEventType | ''); setPage(1) } },
        ]}
        actions={
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['finance-escrow'] })}
            className="flex h-9 items-center gap-1.5 rounded-sm border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <IoSyncOutline className="size-3.5" /> Refresh
          </button>
        }
      />

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No PawaPay events for this filter"
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />
    </div>
  )
}
