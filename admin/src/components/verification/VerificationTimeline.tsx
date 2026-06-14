'use client'

import { cn, fmtDatetime } from '@/lib/utils'
import type { TimelineEvent } from '@/lib/api/verification'

// Vertical progression of a submission's lifecycle, oldest → newest. Lets a
// reviewer see how the application has moved (submitted, auto-checks, claimed,
// info requested, resubmitted, decided) at a glance.

function dotColor(status?: string): string {
  switch (status) {
    case 'APPROVED':
    case 'AUTO_APPROVED':
      return 'bg-teal-500'
    case 'REJECTED':
    case 'AUTO_REJECTED':
    case 'EXPIRED':
      return 'bg-red-500'
    case 'MANUAL_REVIEW':
      return 'bg-amber-500'
    case 'SUBMITTED':
      return 'bg-blue-500'
    default:
      return 'bg-slate-400'
  }
}

export function VerificationTimeline({ events }: { events: TimelineEvent[] }) {
  if (!events || events.length === 0) return null

  return (
    <section aria-labelledby="timeline-heading" className="space-y-2">
      <h3
        id="timeline-heading"
        className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        Progression
      </h3>

      <ol className="relative ml-1 space-y-4 border-l border-slate-200 pl-5 dark:border-slate-700">
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`} className="relative">
            {/* Dot on the rail */}
            <span
              className={cn(
                'absolute -left-[1.4rem] top-1 size-2.5 rounded-full ring-2 ring-white dark:ring-slate-900',
                dotColor(e.status),
              )}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{e.label}</p>
              <span className="text-xs text-slate-400">· {e.actor}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{fmtDatetime(e.at)}</p>
            {e.note && (
              <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {e.note}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
