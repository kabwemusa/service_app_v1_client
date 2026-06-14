'use client'

import { CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tier4Prerequisites as Prereqs } from '@/lib/api/verification'

// §4.5 Professional-tier gate shown alongside the skill proof. The platform
// track-record path requires 20 completed jobs at ≥4.5 average with zero upheld
// disputes. We surface progress so the reviewer can see prerequisite status
// next to the uploaded credential.

function PrereqRow({
  label,
  met,
  value,
}: {
  label: string
  met: boolean
  value: string
}) {
  const Icon = met ? CheckCircle2 : XCircle
  return (
    <div className="flex items-center gap-2 py-1.5">
      <Icon
        className={cn(
          'size-4 shrink-0',
          met ? 'text-teal-600 dark:text-teal-400' : 'text-amber-600 dark:text-amber-400',
        )}
        aria-hidden="true"
      />
      <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">{label}</span>
      <span className="text-sm font-medium tabular-nums text-slate-600 dark:text-slate-400">
        {value}
      </span>
      <span className="sr-only">{met ? 'met' : 'not met'}</span>
    </div>
  )
}

export function Tier4Prerequisites({ prereqs }: { prereqs: Prereqs }) {
  const jobPct = Math.min(100, Math.round((prereqs.completed_jobs / prereqs.required_jobs) * 100))

  return (
    <section aria-labelledby="tier4-heading" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3
          id="tier4-heading"
          className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          Tier 4 prerequisites · §4.5
        </h3>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs font-medium',
            prereqs.all_met
              ? 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-400'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400',
          )}
        >
          {prereqs.all_met ? 'Gate met' : 'Gate not met'}
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 px-3 dark:border-slate-700">
        <PrereqRow
          label={`Completed jobs (≥ ${prereqs.required_jobs})`}
          met={prereqs.jobs_met}
          value={`${prereqs.completed_jobs} / ${prereqs.required_jobs}`}
        />
        {/* Progress bar for the jobs threshold */}
        <div className="pb-2" aria-hidden="true">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div
              className={cn('h-full rounded-full', prereqs.jobs_met ? 'bg-teal-500' : 'bg-amber-400')}
              style={{ width: `${jobPct}%` }}
            />
          </div>
        </div>
        <div className="border-t border-slate-100 dark:border-slate-800">
          <PrereqRow
            label={`Average rating (≥ ${prereqs.required_rating.toFixed(1)})`}
            met={prereqs.rating_met}
            value={prereqs.avg_rating !== null ? prereqs.avg_rating.toFixed(2) : '—'}
          />
        </div>
        <div className="border-t border-slate-100 dark:border-slate-800">
          <PrereqRow
            label="Upheld disputes (must be 0)"
            met={prereqs.disputes_met}
            value={String(prereqs.upheld_disputes)}
          />
        </div>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        The track-record path is one of three §4.5 routes; a verified trade certificate or portfolio
        review can substitute. Review the skill proof above before deciding.
      </p>
    </section>
  )
}
