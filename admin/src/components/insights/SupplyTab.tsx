'use client'

import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IoPeopleOutline, IoTrendingUpOutline, IoSchoolOutline, IoWarningOutline } from 'react-icons/io5'
import { MetricCard } from '@/components/ui/MetricCard'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusPill } from '@/components/ui/StatusPill'
import { fmtPercent } from '@/lib/utils'
import { insightsApi } from '@/lib/api/insights'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

export function SupplyTab() {
  const { data, isLoading } = useQuery({ queryKey: ['insights-supply'], queryFn: () => insightsApi.supply() })

  const maxCount = Math.max(1, ...(data?.availability_heatmap ?? []).map((h) => h.count))
  const heatLookup = new Map((data?.availability_heatmap ?? []).map((h) => [`${h.day_of_week}:${h.hour}`, h.count]))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          title="Recent bookings to new/probation providers"
          value={isLoading || data?.fairness.probation_share_of_recent_bookings == null ? '—' : fmtPercent(data.fairness.probation_share_of_recent_bookings)}
          subtitle="Last 30 days"
          icon={IoTrendingUpOutline}
        />
        <MetricCard
          title="Probation activation rate"
          value={isLoading || data?.fairness.probation_activation_rate == null ? '—' : fmtPercent(data.fairness.probation_activation_rate)}
          subtitle="Probation providers who got a job"
          icon={IoPeopleOutline}
        />
        <MetricCard
          title="Graduation rate"
          value={isLoading || data?.fairness.graduation_rate == null ? '—' : fmtPercent(data.fairness.graduation_rate)}
          subtitle={data ? `≥ ${data.fairness.probation_jobs_threshold} jobs — current snapshot` : undefined}
          icon={IoSchoolOutline}
        />
      </div>

      <Card>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Supply coverage gaps</h3>
        {!isLoading && (data?.coverage_gaps.length ?? 0) === 0 ? (
          <EmptyState title="No coverage gaps" description="Every active category has at least 3 eligible providers." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(data?.coverage_gaps ?? []).map((g) => (
              <li key={g.category_id} className="flex items-center justify-between py-2 text-sm">
                <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <IoWarningOutline className="size-3.5 text-amber-500" /> {g.category_name}
                </span>
                <StatusPill label={`${g.eligible_providers} eligible`} variant={g.eligible_providers === 0 ? 'danger' : 'warning'} autoVariant={false} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Provider availability heatmap</h3>
        <p className="mb-3 text-xs text-slate-400">From recurring availability schedules — darker means more providers available.</p>
        {!isLoading && (data?.availability_heatmap.length ?? 0) === 0 ? (
          <EmptyState title="No availability data yet" />
        ) : (
          <div className="overflow-x-auto">
            <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `40px repeat(24, 16px)` }}>
              <div />
              {HOURS.map((h) => (
                <div key={h} className="text-center text-[9px] text-slate-400">{h % 3 === 0 ? h : ''}</div>
              ))}
              {DAY_LABELS.map((label, day) => (
                <Fragment key={day}>
                  <div className="flex items-center text-[10px] text-slate-500 dark:text-slate-400">{label}</div>
                  {HOURS.map((h) => {
                    const count = heatLookup.get(`${day}:${h}`) ?? 0
                    const intensity = count / maxCount
                    return (
                      <div
                        key={`${day}-${h}`}
                        className="size-4 rounded-[2px]"
                        style={{ backgroundColor: intensity === 0 ? 'var(--color-slate-100, #f1f5f9)' : `rgba(13, 148, 136, ${0.15 + intensity * 0.85})` }}
                        title={`${label} ${h}:00 — ${count} providers`}
                      />
                    )
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
