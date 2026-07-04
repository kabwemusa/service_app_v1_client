'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IoWarningOutline, IoCheckmarkCircleOutline, IoArrowUpCircleOutline, IoCloseCircleOutline, IoOpenOutline } from 'react-icons/io5'
import Link from 'next/link'
import { FilterBar } from '@/components/ui/FilterBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState } from '@/components/ui/EmptyState'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { fmtRelative } from '@/lib/utils'
import { fraudApi, SIGNAL_TYPE_LABEL, type FraudSignal, type SignalStatus, type SignalType } from '@/lib/api/fraud'

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'false_positive', label: 'False positive' },
]

const TYPE_OPTIONS = Object.entries(SIGNAL_TYPE_LABEL).map(([value, label]) => ({ value, label }))

const SEVERITY_VARIANT = { LOW: 'neutral', MEDIUM: 'warning', HIGH: 'danger' } as const

export function FraudPatternsTab() {
  const [status, setStatus] = useState<SignalStatus | ''>('')
  const [signalType, setSignalType] = useState<SignalType | ''>('')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['fraud-patterns', status, signalType],
    queryFn: () => fraudApi.patterns({ status: status || undefined, signal_type: signalType || undefined }),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['fraud-patterns'] })

  const claim = useAuditedMutation<{ signal: FraudSignal }, unknown>({
    capability: 'write:fraud',
    audit: { action: 'fraud.signal_claim', targetType: 'fraud_signal', targetId: '', summary: 'Claim this signal to investigate it.' },
    mutationFn: (p) => fraudApi.claimSignal({ signal: p.signal, reason: p.reason }),
    onSuccess: invalidate,
  })

  const falsePositive = useAuditedMutation<{ signal: FraudSignal }, unknown>({
    capability: 'write:fraud',
    audit: { action: 'fraud.signal_false_positive', targetType: 'fraud_signal', targetId: '', summary: 'Mark this signal as a false positive.' },
    mutationFn: (p) => fraudApi.markFalsePositive({ signal: p.signal, reason: p.reason }),
    onSuccess: invalidate,
  })

  const escalate = useAuditedMutation<{ signal: FraudSignal }, unknown>({
    capability: 'write:fraud',
    audit: { action: 'fraud.signal_escalate', targetType: 'fraud_signal', targetId: '', summary: 'Escalate this signal for further review.' },
    mutationFn: (p) => fraudApi.escalateSignal({ signal: p.signal, reason: p.reason }),
    onSuccess: invalidate,
  })

  const rows = data?.data ?? []

  return (
    <div className="space-y-4">
      <FilterBar
        filters={[
          { key: 'status', label: 'All statuses', value: status, options: STATUS_OPTIONS, onChange: (v) => setStatus(v as SignalStatus | '') },
          { key: 'type', label: 'All signal types', value: signalType, options: TYPE_OPTIONS, onChange: (v) => setSignalType(v as SignalType | '') },
        ]}
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-sm bg-slate-100 dark:bg-slate-800" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No fraud signals" description="Detected patterns will appear here." icon={IoWarningOutline} />
      ) : (
        <div className="divide-y divide-slate-100 rounded-sm border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-800">
          {rows.map((s) => (
            <div key={s.signal_key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{SIGNAL_TYPE_LABEL[s.signal_type]}</span>
                  <StatusPill label={s.severity} variant={SEVERITY_VARIANT[s.severity]} autoVariant={false} />
                  <StatusPill label={s.status.replace('_', ' ')} autoVariant />
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {s.affected_users.map((u) => u.name).join(', ')} · {fmtRelative(s.detected_at)}
                  {s.assigned_admin_name && <> · Assigned to {s.assigned_admin_name}</>}
                </p>
                {s.source_module && (
                  <Link href={`/${s.source_module}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">
                    View in {s.source_module} <IoOpenOutline className="size-3" />
                  </Link>
                )}
              </div>

              <Can do="write:fraud">
                {s.status !== 'false_positive' && s.status !== 'escalated' && (
                  <div className="flex shrink-0 gap-2">
                    {s.status === 'open' && (
                      <button type="button" onClick={() => claim.trigger({ signal: s })} className="flex items-center gap-1 rounded-sm border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                        <IoCheckmarkCircleOutline className="size-3.5" /> Investigate
                      </button>
                    )}
                    <button type="button" onClick={() => escalate.trigger({ signal: s })} className="flex items-center gap-1 rounded-sm border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20">
                      <IoArrowUpCircleOutline className="size-3.5" /> Escalate
                    </button>
                    <button type="button" onClick={() => falsePositive.trigger({ signal: s })} className="flex items-center gap-1 rounded-sm border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700">
                      <IoCloseCircleOutline className="size-3.5" /> False positive
                    </button>
                  </div>
                )}
              </Can>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
