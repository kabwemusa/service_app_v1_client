'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  IoPeopleOutline, IoCalendarOutline, IoScaleOutline, IoWarningOutline,
  IoShieldCheckmarkOutline, IoAlertCircleOutline, IoCashOutline, IoChevronForward,
} from 'react-icons/io5'
import type { IconType } from 'react-icons'
import { MetricCard } from '@/components/ui/MetricCard'
import { dashboardApi } from '@/lib/api/dashboard'
import { useCan } from '@/lib/rbac/use-can'
import type { Capability } from '@/lib/api/types'

function fmtCount(n: number | undefined, loading: boolean): string {
  if (loading || n === undefined) return '—'
  return n.toLocaleString()
}

interface QueueDef {
  key: 'kyc_pending' | 'safety_open' | 'payouts_failed'
  title: string
  href: string
  icon: IconType
  capability: Capability
  emptyHint: string
  attentionHint: string
}

const QUEUES: QueueDef[] = [
  {
    key: 'kyc_pending',
    title: 'KYC awaiting review',
    href: '/verification',
    icon: IoShieldCheckmarkOutline,
    capability: 'read:verification',
    emptyHint: 'Queue clear',
    attentionHint: 'Open verification queue',
  },
  {
    key: 'safety_open',
    title: 'Open safety cases',
    href: '/safety',
    icon: IoAlertCircleOutline,
    capability: 'safety.handle',
    emptyHint: 'No open cases',
    attentionHint: 'Triage safety queue',
  },
  {
    key: 'payouts_failed',
    title: 'Payouts to retry',
    href: '/finance',
    icon: IoCashOutline,
    capability: 'read:payouts',
    emptyHint: 'All payouts clear',
    attentionHint: 'Review failed payouts',
  },
]

function QueueCard({ def, count, loading }: { def: QueueDef; count: number | undefined; loading: boolean }) {
  const can = useCan(def.capability)
  if (!can) return null

  const Icon = def.icon
  const hasWork = !loading && count !== undefined && count > 0

  return (
    <Link
      href={def.href}
      className="group flex items-center gap-4 rounded-sm border border-slate-200 bg-white p-4 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/60"
    >
      <div
        className={
          'rounded-sm p-2 ' +
          (hasWork
            ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
            : 'bg-slate-50 text-slate-400 dark:bg-slate-700 dark:text-slate-300')
        }
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-500 dark:text-slate-400">{def.title}</p>
        <p className="mt-0.5 text-xl font-medium text-slate-900 dark:text-slate-100">
          {fmtCount(count, loading)}
        </p>
      </div>
      <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
        {hasWork ? def.attentionHint : def.emptyHint}
        <IoChevronForward className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}

export function DashboardMetrics() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => dashboardApi.overview(),
    // Health numbers should feel current without hammering the API.
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const k = data?.kpis

  return (
    <div className="space-y-6">
      {isError && (
        <div className="rounded-sm border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          Could not load dashboard figures. Retrying shortly.
        </div>
      )}

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard title="Active providers" value={fmtCount(k?.active_providers, isLoading)} icon={IoPeopleOutline} />
        <MetricCard title="Bookings today" value={fmtCount(k?.bookings_today, isLoading)} icon={IoCalendarOutline} />
        <MetricCard title="Open disputes" value={fmtCount(k?.open_disputes, isLoading)} icon={IoScaleOutline} />
        <MetricCard title="Fraud flags (24h)" value={fmtCount(k?.fraud_flags_24h, isLoading)} icon={IoWarningOutline} />
      </div>

      {/* Queues needing attention */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">Needs attention</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUEUES.map((def) => (
            <QueueCard key={def.key} def={def} count={data?.queues[def.key]} loading={isLoading} />
          ))}
        </div>
      </div>
    </div>
  )
}
