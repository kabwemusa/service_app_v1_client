'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { IoOpenOutline, IoArrowUpCircleOutline } from 'react-icons/io5'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState } from '@/components/ui/EmptyState'
import { fmtRelative } from '@/lib/utils'
import { fraudApi, SIGNAL_TYPE_LABEL } from '@/lib/api/fraud'

const SEVERITY_VARIANT = { LOW: 'neutral', MEDIUM: 'warning', HIGH: 'danger' } as const

export function FraudEscalationsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['fraud-escalations'],
    queryFn: () => fraudApi.escalations(),
  })

  const rows = data?.data ?? []

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Items surfaced from other modules — Reviews (manipulation patterns) and Safety (high-severity reports). Each links back to its source.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-sm bg-slate-100 dark:bg-slate-800" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No escalations" description="Items escalated from Reviews or Safety will appear here." icon={IoArrowUpCircleOutline} />
      ) : (
        <div className="divide-y divide-slate-100 rounded-sm border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-800">
          {rows.map((s) => (
            <div key={s.signal_key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{SIGNAL_TYPE_LABEL[s.signal_type]}</span>
                  <StatusPill label={s.severity} variant={SEVERITY_VARIANT[s.severity]} autoVariant={false} />
                  <StatusPill label={s.status.replace('_', ' ')} autoVariant />
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {s.affected_users.map((u) => u.name).join(', ')} · {fmtRelative(s.detected_at)}
                </p>
              </div>
              {s.source_module && (
                <Link href={`/${s.source_module}`} className="flex shrink-0 items-center gap-1 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">
                  Open in {s.source_module} <IoOpenOutline className="size-3" />
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
