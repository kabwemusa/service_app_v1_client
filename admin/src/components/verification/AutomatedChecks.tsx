'use client'

import type { ReactNode } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, MinusCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AutomatedChecks as Checks } from '@/lib/api/verification'

// Read-only surfacing of the automated check engine's results (§4.3 pipeline,
// §5.3 image pipeline). The reviewer decides; the system advises — so these are
// presented as advisory rows, never as gating controls.

type Tone = 'pass' | 'fail' | 'warn' | 'none'

const TONE_META: Record<Tone, { icon: typeof CheckCircle2; cls: string; word: string }> = {
  pass: { icon: CheckCircle2, cls: 'text-teal-600 dark:text-teal-400', word: 'Pass' },
  fail: { icon: XCircle, cls: 'text-red-600 dark:text-red-400', word: 'Fail' },
  warn: { icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400', word: 'Flagged' },
  none: { icon: MinusCircle, cls: 'text-slate-400', word: 'N/A' },
}

function CheckRow({ label, tone, detail }: { label: string; tone: Tone; detail?: ReactNode }) {
  const { icon: Icon, cls, word } = TONE_META[tone]
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon className={cn('mt-0.5 size-4 shrink-0', cls)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
          {/* Status conveyed by text, not colour alone */}
          <span className={cn('text-xs font-medium', cls)}>{word}</span>
        </div>
        {detail && (
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{detail}</p>
        )}
      </div>
    </div>
  )
}

export function AutomatedChecks({ checks }: { checks: Checks }) {
  const rows: ReactNode[] = []

  if (checks.image_quality) {
    rows.push(
      <CheckRow
        key="quality"
        label="Image quality"
        tone={checks.image_quality.passed ? 'pass' : 'fail'}
        detail={checks.image_quality.flag}
      />,
    )
  }
  if (checks.authenticity) {
    rows.push(
      <CheckRow
        key="authenticity"
        label="Document authenticity"
        tone={checks.authenticity.flags.length ? 'warn' : 'pass'}
        detail={
          <>
            Confidence {checks.authenticity.score.toFixed(2)}
            {checks.authenticity.flags.length > 0 &&
              ` · ${checks.authenticity.flags.join(', ')}`}
          </>
        }
      />,
    )
  }
  if (checks.liveness) {
    rows.push(
      <CheckRow
        key="liveness"
        label="Liveness / face match"
        tone={checks.liveness.passed ? 'pass' : 'fail'}
        detail={`Match score ${checks.liveness.score.toFixed(2)} (≥ 0.85 required)`}
      />,
    )
  }
  if (checks.database_match) {
    rows.push(
      <CheckRow
        key="db"
        label="Denylist / database check"
        tone={checks.database_match.matched ? 'fail' : 'pass'}
        detail={
          checks.database_match.matched
            ? `Match found${checks.database_match.source ? ` · ${checks.database_match.source}` : ''}`
            : 'No match'
        }
      />,
    )
  }
  if (checks.duplicate_identity) {
    rows.push(
      <CheckRow
        key="dup"
        label="Duplicate identity"
        tone={checks.duplicate_identity.matched ? 'fail' : 'pass'}
        detail={checks.duplicate_identity.matched ? 'Identity hash already bound to an account' : 'Unique'}
      />,
    )
  }
  if (checks.name_consistency) {
    rows.push(
      <CheckRow
        key="name"
        label="Name consistency"
        tone={checks.name_consistency.matched ? 'pass' : 'warn'}
        detail={
          checks.name_consistency.distance !== undefined
            ? `Edit distance ${checks.name_consistency.distance}`
            : undefined
        }
      />,
    )
  }
  if (checks.nsfw) {
    rows.push(
      <CheckRow
        key="nsfw"
        label="NSFW scan"
        tone={checks.nsfw.flagged ? 'warn' : 'pass'}
        detail={checks.nsfw.flagged ? 'Flagged for content review' : 'Clear'}
      />,
    )
  }
  if (checks.phash_duplicate) {
    rows.push(
      <CheckRow
        key="phash"
        label="Reverse-image (pHash)"
        tone={checks.phash_duplicate.flagged ? 'warn' : 'pass'}
        detail={checks.phash_duplicate.flagged ? 'Matches an existing platform image' : 'No duplicate found'}
      />,
    )
  }

  return (
    <section aria-labelledby="checks-heading" className="space-y-1">
      <h3
        id="checks-heading"
        className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        Automated checks · advisory
      </h3>
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-slate-400">No automated results recorded.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-3 dark:divide-slate-800 dark:border-slate-700">
          {rows}
        </div>
      )}
    </section>
  )
}
