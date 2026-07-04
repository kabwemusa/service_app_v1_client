'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { IoStatsChartOutline, IoWarningOutline, IoTimeOutline } from 'react-icons/io5'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Card } from '@/components/ui/Card'
import { MetricCard } from '@/components/ui/MetricCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusPill } from '@/components/ui/StatusPill'
import { fmtPercent, fmtRelative } from '@/lib/utils'
import { insightsApi } from '@/lib/api/insights'

const AXIS_STYLE = { fontSize: 11, fill: '#94a3b8' }

export function TrustTab() {
  const { data, isLoading } = useQuery({ queryKey: ['insights-trust'], queryFn: () => insightsApi.trust() })

  const shrinkagePct = data && data.shrinkage.total_providers > 0
    ? data.shrinkage.shrinkage_dominated / data.shrinkage.total_providers
    : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard title="Providers scored" value={isLoading ? '—' : String(data?.shrinkage.total_providers ?? 0)} icon={IoStatsChartOutline} />
        <MetricCard
          title="Shrinkage-dominated"
          value={isLoading || shrinkagePct == null ? '—' : fmtPercent(shrinkagePct)}
          subtitle={data ? `< ${data.shrinkage.min_reviews_threshold} reviews` : undefined}
          icon={IoTimeOutline}
        />
        <MetricCard title="Low-score providers (< 40)" value={isLoading ? '—' : String(data?.low_score_providers.length ?? 0)} icon={IoWarningOutline} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Trust score distribution</h3>
          <p className="mb-2 text-xs text-slate-400">Internal composite score — never shown to users.</p>
          {!isLoading && (data?.score_distribution.every((b) => b.count === 0)) ? (
            <EmptyState title="No scored providers yet" />
          ) : (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.score_distribution ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="bucket" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: 'none', fontSize: 12 }} />
                  <Bar dataKey="count" fill="#0d9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Providers per tier</h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(data?.tier_breakdown ?? []).map((t) => ({ ...t, label: `Tier ${t.tier}` }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: 'none', fontSize: 12 }} />
                <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Low-score providers — flagged for review</h3>
        {!isLoading && (data?.low_score_providers.length ?? 0) === 0 ? (
          <EmptyState title="No low-score providers" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(data?.low_score_providers ?? []).map((p) => (
              <li key={p.provider_id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-700 dark:text-slate-300">{p.name}</span>
                <div className="flex items-center gap-2">
                  <StatusPill label={p.score.toFixed(1)} variant="danger" autoVariant={false} />
                  <Link href={`/users?user=${p.provider_id}`} className="text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">View</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent recompute events</h3>
        {!isLoading && (data?.recompute_events.length ?? 0) === 0 ? (
          <EmptyState title="No recomputes in the last 30 days" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(data?.recompute_events ?? []).map((e, i) => (
              <li key={i} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-600 dark:text-slate-400">
                  {e.old_score !== null ? `${e.old_score.toFixed(1)} → ${e.new_score.toFixed(1)}` : `set to ${e.new_score.toFixed(1)}`}
                </span>
                <div className="flex items-center gap-2">
                  <StatusPill label={e.reason} autoVariant />
                  <span className="text-xs text-slate-400">{fmtRelative(e.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
