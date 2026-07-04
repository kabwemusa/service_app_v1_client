'use client'

import { useQuery } from '@tanstack/react-query'
import { IoRocketOutline, IoLayersOutline, IoAlertCircleOutline } from 'react-icons/io5'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { MetricCard } from '@/components/ui/MetricCard'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { fmtPercent, fmtDatetime } from '@/lib/utils'
import { insightsApi } from '@/lib/api/insights'

const AXIS_STYLE = { fontSize: 11, fill: '#94a3b8' }

export function DispatchTab() {
  const { data, isLoading } = useQuery({ queryKey: ['insights-dispatch'], queryFn: () => insightsApi.dispatch() })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard title="Bookings dispatched (30d)" value={isLoading ? '—' : String(data?.kpis.bookings_dispatched ?? 0)} icon={IoRocketOutline} />
        <MetricCard title="Avg cascade depth before accept" value={isLoading || data?.kpis.avg_cascade_depth == null ? '—' : data.kpis.avg_cascade_depth.toFixed(2)} icon={IoLayersOutline} />
        <MetricCard title="No-provider rate" value={isLoading || data?.kpis.no_provider_rate == null ? '—' : fmtPercent(data.kpis.no_provider_rate)} icon={IoAlertCircleOutline} />
      </div>

      <Card>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Cascade depth distribution</h3>
        <p className="mb-3 text-xs text-slate-400">How many candidates it took before a booking was accepted. 0 = the 1st-ranked provider took it.</p>
        {!isLoading && (data?.cascade_distribution.length ?? 0) === 0 ? (
          <EmptyState title="No dispatch activity yet" />
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.cascade_distribution ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="depth" tickFormatter={(d) => `#${Number(d) + 1}`} tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip labelFormatter={(d) => `Candidate #${Number(d) + 1}`} contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: 'none', fontSize: 12 }} />
                <Bar dataKey="count" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent no-provider events</h3>
        {!isLoading && (data?.no_provider_events.length ?? 0) === 0 ? (
          <EmptyState title="No exhausted-candidate events" description="Good sign — supply is keeping up." icon={IoAlertCircleOutline} />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(data?.no_provider_events ?? []).map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-600 dark:text-slate-400">{fmtDatetime(e.created_at)}</span>
                <span className="text-xs text-slate-400">{e.time_of_day}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
