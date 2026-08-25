'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  IoCashOutline, IoTrendingUpOutline, IoLockClosedOutline, IoArrowUndoOutline, IoPricetagOutline,
} from 'react-icons/io5'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar,
} from 'recharts'
import { MetricCard } from '@/components/ui/MetricCard'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { fmtZMW, fmtPercent, fmtDate } from '@/lib/utils'
import { financeApi, type Period } from '@/lib/api/finance'
import { FinanceLiveFeed } from '@/components/finance/FinanceLiveFeed'

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
]

// Flat, no-shadow chart styling to match the rest of the panel.
const AXIS_STYLE = { fontSize: 11, fill: 'var(--color-slate-400, #94a3b8)' }
const GRID_STROKE = 'var(--color-slate-200, #e2e8f0)'

export function FinanceOverviewTab() {
  const [period, setPeriod] = useState<Period>('month')

  const { data, isLoading } = useQuery({
    queryKey: ['finance-overview', period],
    queryFn: () => financeApi.overview({ period }),
  })

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center gap-1">
        {PERIOD_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setPeriod(o.value)}
            className={
              'h-8 rounded-sm px-3 text-xs font-medium transition-colors ' +
              (period === o.value
                ? 'bg-teal-600 text-white'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800')
            }
          >
            {o.label}
          </button>
        ))}
      </div>

      <FinanceLiveFeed />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="GMV this period"
          value={isLoading ? '—' : fmtZMW(data?.kpis.gmv ?? 0)}
          icon={IoCashOutline}
        />
        <MetricCard
          title="Commission collected"
          value={isLoading ? '—' : fmtZMW(data?.kpis.commission_collected ?? 0)}
          icon={IoTrendingUpOutline}
        />
        <MetricCard
          title="Active escrow float"
          value={isLoading ? '—' : fmtZMW(data?.kpis.active_escrow_float ?? 0)}
          subtitle="Held by Lipila"
          icon={IoLockClosedOutline}
        />
        <MetricCard
          title="Refunds issued"
          value={isLoading ? '—' : String(data?.kpis.refunds_issued ?? 0)}
          subtitle={isLoading ? undefined : fmtZMW(data?.kpis.refunds_total ?? 0)}
          icon={IoArrowUndoOutline}
        />
        <MetricCard
          title="Avg commission rate"
          value={isLoading ? '—' : fmtPercent(data?.kpis.avg_commission_rate ?? 0)}
          icon={IoPricetagOutline}
        />
      </div>

      {/* GMV + commission trend */}
      <Card>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          GMV &amp; commission — last 30 days
        </h3>
        {!isLoading && (data?.trend.length ?? 0) === 0 ? (
          <EmptyState title="No trend data yet" description="Chart fills in as bookings complete." />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.trend ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} tickFormatter={(v) => fmtZMW(v)} width={70} />
                <Tooltip
                  formatter={(value: number) => fmtZMW(value)}
                  labelFormatter={(d) => fmtDate(d as string)}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: 'none', fontSize: 12 }}
                />
                <Line type="monotone" dataKey="gmv" stroke="#0d9488" strokeWidth={2} dot={false} name="GMV" />
                <Line type="monotone" dataKey="commission" stroke="#f59e0b" strokeWidth={2} dot={false} name="Commission" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Top categories by GMV */}
      <Card>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Top categories by GMV
        </h3>
        {!isLoading && (data?.top_categories.length ?? 0) === 0 ? (
          <EmptyState title="No category data yet" icon={IoPricetagOutline} />
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.top_categories ?? []} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                <XAxis type="number" tick={AXIS_STYLE} axisLine={false} tickLine={false} tickFormatter={(v) => fmtZMW(v)} />
                <YAxis type="category" dataKey="name" tick={AXIS_STYLE} axisLine={false} tickLine={false} width={110} />
                <Tooltip
                  formatter={(value: number) => fmtZMW(value)}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: 'none', fontSize: 12 }}
                />
                <Bar dataKey="gmv" fill="#0d9488" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  )
}
