'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { IoPricetagOutline, IoDownloadOutline } from 'react-icons/io5'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { Card } from '@/components/ui/Card'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { fmtZMW, fmtPercent, fmtDate } from '@/lib/utils'
import { financeApi, type CommissionRow, type CommissionStatus, type CommissionBand } from '@/lib/api/finance'

const STATUS_OPTIONS = [
  { value: 'collected', label: 'Collected' },
  { value: 'uncollected', label: 'Uncollected' },
  { value: 'disputed', label: 'Disputed' },
]

const TIER_OPTIONS = [
  { value: '1', label: 'Tier 1' },
  { value: '2', label: 'Tier 2' },
  { value: '3', label: 'Tier 3' },
  { value: '4', label: 'Tier 4' },
]

export function FinanceCommissionsTab() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<CommissionStatus | ''>('')
  const [tier, setTier] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['finance-commissions', page, status, tier],
    queryFn: () => financeApi.commissions({ page, status: status || undefined, tier }),
  })

  const columns = useMemo<ColumnDef<CommissionRow>[]>(() => [
    { accessorKey: 'booking_id', header: 'Booking', cell: ({ row }) => (
      <span className="font-mono text-xs text-slate-500">{row.original.booking_id.slice(0, 8)}…</span>
    ) },
    { accessorKey: 'provider_name', header: 'Provider' },
    { accessorKey: 'buyer_name', header: 'Customer' },
    { accessorKey: 'category_name', header: 'Category', cell: ({ row }) => row.original.category_name ?? '—' },
    { accessorKey: 'gross_amount', header: 'Agreed amount', cell: ({ row }) => fmtZMW(row.original.gross_amount) },
    { accessorKey: 'commission_rate', header: 'Rate', cell: ({ row }) => fmtPercent(row.original.commission_rate) },
    { accessorKey: 'commission_amount', header: 'Commission', cell: ({ row }) => fmtZMW(row.original.commission_amount) },
    { accessorKey: 'tier', header: 'Tier', cell: ({ row }) => `Tier ${row.original.tier}` },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusPill label={row.original.status} autoVariant /> },
    { accessorKey: 'calculated_at', header: 'Date', cell: ({ row }) => fmtDate(row.original.calculated_at) },
  ], [])

  function exportCsv() {
    const rows = data?.data ?? []
    const header = ['booking_id', 'provider', 'customer', 'category', 'gross_amount', 'rate', 'commission', 'tier', 'status', 'date']
    const lines = rows.map((r) => [
      r.booking_id, r.provider_name, r.buyer_name, r.category_name ?? '', r.gross_amount,
      r.commission_rate, r.commission_amount, r.tier, r.status, r.calculated_at,
    ].join(','))
    const csv = [header.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `commissions-page-${page}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <FilterBar
        filters={[
          { key: 'status', label: 'All statuses', value: status, options: STATUS_OPTIONS, onChange: (v) => { setStatus(v as CommissionStatus | ''); setPage(1) } },
          { key: 'tier', label: 'All tiers', value: tier, options: TIER_OPTIONS, onChange: (v) => { setTier(v); setPage(1) } },
        ]}
        actions={
          <button
            type="button"
            onClick={exportCsv}
            className="flex h-9 items-center gap-1.5 rounded-sm border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <IoDownloadOutline className="size-3.5" /> Export CSV
          </button>
        }
      />

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No commission records for this filter"
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />

      <CommissionBandsCard />
    </div>
  )
}

// ── Commission band config (category × tier rate matrix) ─────────────────────

function CommissionBandsCard() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['finance-commission-bands'],
    queryFn: () => financeApi.commissionBands(),
  })

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <IoPricetagOutline className="size-3.5" /> Commission bands
        </h3>
        <Can do="write:commissions" fallback={<span className="text-xs text-slate-400">Read-only</span>}>
          <span className="text-xs text-slate-400">Editable — every change is audited</span>
        </Can>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Category</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Tier 1</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Tier 2</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Tier 3</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Tier 4</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((band) => (
                <BandRow key={band.id} band={band} onSaved={() => queryClient.invalidateQueries({ queryKey: ['finance-commission-bands'] })} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function BandRow({ band, onSaved }: { band: CommissionBand; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [rates, setRates] = useState(band.rates)

  const update = useAuditedMutation<{ rates: Record<string, number> }, unknown>({
    capability: 'write:commissions',
    audit: {
      action: 'finance.commission_band_update',
      targetType: 'category',
      targetId: String(band.id),
      summary: `Update the commission rates for "${band.name}". This changes the platform cut on every future booking in this category.`,
    },
    mutationFn: (p) => financeApi.updateCommissionBand(band.id, { rates: p.rates, reason: p.reason }),
    onSuccess: () => { setEditing(false); onSaved() },
  })

  if (!editing) {
    return (
      <tr className="border-b border-slate-100 last:border-0 dark:border-slate-800">
        <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{band.name}</td>
        {(['1', '2', '3', '4'] as const).map((t) => (
          <td key={t} className="px-3 py-2 text-slate-600 dark:text-slate-400">{Math.round(band.rates[t] * 100)}%</td>
        ))}
        <td className="px-3 py-2 text-right">
          <Can do="write:commissions">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-teal-600 hover:underline dark:text-teal-400"
            >
              Edit
            </button>
          </Can>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-slate-100 bg-slate-50 last:border-0 dark:border-slate-800 dark:bg-slate-800/50">
      <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{band.name}</td>
      {(['1', '2', '3', '4'] as const).map((t) => (
        <td key={t} className="px-3 py-1.5">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={Math.round(rates[t] * 100)}
            onChange={(e) => setRates((r) => ({ ...r, [t]: Number(e.target.value) / 100 }))}
            className="h-8 w-16 rounded-sm border border-slate-200 px-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
        </td>
      ))}
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setEditing(false); setRates(band.rates) }} className="text-xs text-slate-500 hover:underline">
            Cancel
          </button>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => update.trigger({ rates })}
            className="text-xs font-medium text-teal-600 hover:underline dark:text-teal-400"
          >
            Save
          </button>
        </div>
      </td>
    </tr>
  )
}
