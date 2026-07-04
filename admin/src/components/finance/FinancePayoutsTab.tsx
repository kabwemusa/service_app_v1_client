'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { IoRefreshOutline } from 'react-icons/io5'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { fmtZMW, fmtDatetime } from '@/lib/utils'
import { financeApi, type PayoutRow, type PayoutStatus } from '@/lib/api/finance'

const STATUS_OPTIONS = [
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
]

export function FinancePayoutsTab() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<PayoutStatus | ''>('')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['finance-payouts', page, status],
    queryFn: () => financeApi.payouts({ page, status: status || undefined }),
  })

  const retry = useAuditedMutation<{ bookingId: string }, unknown>({
    capability: 'write:payouts',
    audit: {
      action: 'finance.payout_retry',
      targetType: 'booking',
      targetId: '',
      summary: 'Retry disbursing this payout to the provider via PawaPay.',
    },
    mutationFn: (p) => financeApi.retryPayout(p.bookingId, { reason: p.reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finance-payouts'] }),
  })

  const columns = useMemo<ColumnDef<PayoutRow>[]>(() => [
    { accessorKey: 'provider_name', header: 'Provider' },
    { accessorKey: 'booking_id', header: 'Booking', cell: ({ row }) => (
      <span className="font-mono text-xs text-slate-500">{row.original.booking_id.slice(0, 8)}…</span>
    ) },
    { accessorKey: 'amount', header: 'Amount', cell: ({ row }) => fmtZMW(row.original.amount) },
    { accessorKey: 'momo_masked', header: 'MoMo number', cell: ({ row }) => row.original.momo_masked ?? '—' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => (
      <StatusPill label={row.original.status} variant={row.original.status === 'success' ? 'active' : row.original.status === 'failed' ? 'danger' : 'pending'} autoVariant={false} />
    ) },
    { accessorKey: 'pawapay_ref', header: 'PawaPay reference', cell: ({ row }) => (
      <span className="font-mono text-xs text-slate-500">{row.original.pawapay_ref ?? '—'}</span>
    ) },
    { accessorKey: 'timestamp', header: 'Time', cell: ({ row }) => row.original.timestamp ? fmtDatetime(row.original.timestamp) : '—' },
    {
      id: 'action',
      header: '',
      // 'pending' means no payout has been attempted yet (still inside the
      // tier's hold window) — admins can force it now, same endpoint as retry.
      // 'success' has nothing to do.
      cell: ({ row }) => row.original.status !== 'success' && (
        <Can do="write:payouts">
          <button
            type="button"
            disabled={retry.isPending}
            onClick={() => retry.trigger({ bookingId: row.original.booking_id })}
            className="flex items-center gap-1 text-xs font-medium text-teal-600 hover:underline disabled:opacity-50 dark:text-teal-400"
          >
            <IoRefreshOutline className="size-3.5" />
            {row.original.status === 'failed' ? 'Retry' : 'Disburse now'}
          </button>
        </Can>
      ),
    },
  ], [retry])

  return (
    <div className="space-y-4">
      <FilterBar
        filters={[
          { key: 'status', label: 'All statuses', value: status, options: STATUS_OPTIONS, onChange: (v) => { setStatus(v as PayoutStatus | ''); setPage(1) } },
        ]}
      />

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No payouts for this filter"
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />
    </div>
  )
}
