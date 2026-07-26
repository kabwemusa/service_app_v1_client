'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/DataTable'
import { StatusPill } from '@/components/ui/StatusPill'
import { MetricCard } from '@/components/ui/MetricCard'
import { fmtZMW, fmtDate } from '@/lib/utils'
import { promotionsApi, type CampaignRow } from '@/lib/api/promotions'

/**
 * Per-campaign performance. Attribution is honest: we report redemptions, spend,
 * and bookings a redemption was attached to — but we do NOT run a holdout, so
 * incremental lift is explicitly not claimed.
 */
export function PromotionsPerformanceTab() {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['promotions-campaigns', 'performance', page],
    queryFn: () => promotionsApi.campaigns({ page }),
  })

  const { data: perf } = useQuery({
    queryKey: ['promotions-performance', selected],
    queryFn: () => promotionsApi.performance(selected as string),
    enabled: !!selected,
  })

  const columns = useMemo<ColumnDef<CampaignRow>[]>(() => [
    { accessorKey: 'name', header: 'Campaign' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusPill label={row.original.status.replace('_', ' ')} /> },
    { id: 'redemptions', header: 'Redemptions', cell: ({ row }) => row.original.metrics.redemptions },
    { id: 'spend', header: 'Spend', cell: ({ row }) => fmtZMW(row.original.metrics.spend) },
    { id: 'bookings', header: 'Bookings driven', cell: ({ row }) => row.original.metrics.bookings_driven },
    {
      id: 'view',
      header: '',
      cell: ({ row }) => (
        <button type="button" onClick={() => setSelected(row.original.id)} className="text-xs font-medium text-teal-600 hover:underline">
          Details
        </button>
      ),
    },
  ], [])

  return (
    <div className="space-y-4">
      <DataTable
        data={data?.data ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No campaigns to report on yet"
        totalRows={data?.meta.total}
        currentPage={page}
        pageSize={data?.meta.per_page ?? 20}
        onPageChange={setPage}
      />

      {selected && perf?.data && (
        <div className="space-y-3 rounded-sm border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{perf.data.campaign.name}</h3>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-slate-400 hover:text-slate-600">Close</button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard title="Redemptions" value={perf.data.redemptions} />
            <MetricCard title="Discount spend" value={fmtZMW(perf.data.spend)} />
            <MetricCard title="Bookings driven" value={perf.data.bookings_driven} />
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {perf.data.incremental_measured
              ? 'Incremental lift measured against a holdout.'
              : 'Incremental lift is not measured (no holdout) — figures show redemptions directly attributed to this campaign.'}
          </p>
          {perf.data.daily.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-400">
                  <tr><th className="py-1 pr-4">Day</th><th className="py-1 pr-4">Redemptions</th><th className="py-1">Spend</th></tr>
                </thead>
                <tbody className="text-slate-600 dark:text-slate-300">
                  {perf.data.daily.map((d) => (
                    <tr key={d.day}><td className="py-1 pr-4">{fmtDate(d.day)}</td><td className="py-1 pr-4">{d.redemptions}</td><td className="py-1">{fmtZMW(d.spend)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
