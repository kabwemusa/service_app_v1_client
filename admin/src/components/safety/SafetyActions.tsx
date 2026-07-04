'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  IoCheckmarkCircleOutline, IoBanOutline, IoHammerOutline, IoArrowUpCircleOutline, IoClipboardOutline, IoOpenOutline,
} from 'react-icons/io5'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/store/toast-store'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import {
  safetyApi,
  OUTCOME_LABEL,
  type SafetyDetail,
  type ResolveOutcome,
} from '@/lib/api/safety'

interface Props {
  detail: SafetyDetail
  onChanged: () => void
}

// Every protective/escalation action runs through useAuditedMutation →
// ConfirmWithReason (reason mandatory) → the API writes the state change + audit
// entry in one transaction. Notes are append-only and not a state change, so they
// post directly. Suspending the reported USER calls straight into the Users
// module action (no duplicated logic) and is recorded in both modules; the
// Users module link is kept for finer-grained options (ban, tier, denylist).
export function SafetyActions({ detail, onChanged }: Props) {
  const { kind, id } = detail
  const isReport = kind === 'report'

  const ctx = (action: string, summary: string) => ({
    action,
    targetType: isReport ? 'safety_report' : 'emergency_event',
    targetId: id,
    summary,
  })

  const claim = useAuditedMutation<Record<string, never>, SafetyDetail>({
    capability: 'safety.handle',
    audit: ctx('Claim case', 'Assign this case to yourself and mark it investigating.'),
    mutationFn: (p) => safetyApi.claim(kind, id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const restrictContact = useAuditedMutation<Record<string, never>, SafetyDetail>({
    capability: 'safety.handle',
    audit: ctx('Restrict contact', 'Block further contact between the reporter and the reported party while this is investigated.'),
    mutationFn: (p) => safetyApi.restrictContact(kind, id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  // Calls straight into the Users module (single source of truth for the
  // mutation) — this only records the link, so both modules carry an audit
  // entry for the decision.
  const restrictReportedUser = useAuditedMutation<Record<string, never>, SafetyDetail>({
    capability: 'safety.handle',
    audit: ctx('Suspend reported user', 'Suspend the reported account as a result of this report. This calls the Users module action and is recorded in both places.'),
    mutationFn: (p) => safetyApi.restrictReportedUser(kind, id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const escalateAuthority = useAuditedMutation<Record<string, never>, SafetyDetail>({
    capability: 'safety.handle',
    audit: ctx('Flag for authority escalation', 'Record a decision to escalate this to the authorities. The platform does NOT contact them — this only records that you decided to.'),
    mutationFn: (p) => safetyApi.escalateAuthority(kind, id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const escalateSuperAdmin = useAuditedMutation<Record<string, never>, SafetyDetail>({
    capability: 'safety.handle',
    audit: ctx('Escalate to super admin', 'Escalate this case to a super admin for sign-off.'),
    mutationFn: (p) => safetyApi.escalateSuperAdmin(kind, id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const resolve = useAuditedMutation<{ outcome: ResolveOutcome }, SafetyDetail>({
    capability: 'safety.handle',
    audit: ctx('Resolve case', 'Close this case with an outcome. The record becomes read-only.'),
    mutationFn: (p) => safetyApi.resolve(kind, id, { outcome: p.outcome, reason: p.reason }),
    onSuccess: onChanged,
  })

  const [outcome, setOutcome] = useState<ResolveOutcome>('ACTION_TAKEN')
  const [showResolve, setShowResolve] = useState(false)

  const claimed = !!detail.assigned

  return (
    <div className="space-y-3">
      {/* Triage + escalation */}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          icon={IoCheckmarkCircleOutline}
          label={claimed ? `Claimed · ${detail.assigned?.admin_name ?? 'assigned'}` : 'Claim & investigate'}
          tone="teal"
          disabled={claim.isPending}
          onClick={() => claim.trigger({})}
        />

        {isReport && (
          <ActionButton
            icon={IoBanOutline}
            label={detail.contact_restricted ? 'Contact restricted' : 'Restrict contact'}
            tone="amber"
            disabled={detail.contact_restricted || restrictContact.isPending}
            onClick={() => restrictContact.trigger({})}
          />
        )}

        {isReport && (
          <ActionButton
            icon={IoHammerOutline}
            label={detail.authority_escalated_at ? 'Authority escalation recorded' : 'Flag for authority'}
            tone="red"
            disabled={!!detail.authority_escalated_at || escalateAuthority.isPending}
            onClick={() => escalateAuthority.trigger({})}
          />
        )}

        {isReport && (
          <ActionButton
            icon={IoArrowUpCircleOutline}
            label={detail.super_admin_escalated ? 'Escalated' : 'Escalate to super admin'}
            tone="slate"
            disabled={detail.super_admin_escalated || escalateSuperAdmin.isPending}
            onClick={() => escalateSuperAdmin.trigger({})}
          />
        )}

        <ActionButton
          icon={IoCheckmarkCircleOutline}
          label="Resolve"
          tone="teal"
          disabled={resolve.isPending}
          onClick={() => setShowResolve((s) => !s)}
          aria-expanded={showResolve}
        />
      </div>

      {/* Protective: suspend the reported USER via the Users module action */}
      {isReport && detail.reported && (
        <div className="rounded-sm border border-dashed border-slate-300 bg-slate-50 p-3 text-xs dark:border-slate-600 dark:bg-slate-800/50">
          <p className="text-slate-500 dark:text-slate-400">
            Suspending the reported account applies platform-wide and is audited in both this report
            and the Users module.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ActionButton
              icon={IoBanOutline}
              label={detail.account_restricted ? 'Reported user suspended' : 'Suspend reported user'}
              tone="red"
              disabled={detail.account_restricted || restrictReportedUser.isPending}
              onClick={() => restrictReportedUser.trigger({})}
            />
            <Link
              href={`/users?user=${detail.reported.user_id}`}
              className="inline-flex items-center gap-1 font-medium text-teal-600 hover:underline dark:text-teal-400"
            >
              Open in Users for more options (ban, tier, denylist) <IoOpenOutline className="size-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Resolve sub-form */}
      {showResolve && (
        <div className="flex flex-wrap items-end gap-2 rounded-sm border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Outcome
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as ResolveOutcome)}
              className="mt-1 block h-9 rounded-sm border border-slate-200 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            >
              {(Object.keys(OUTCOME_LABEL) as ResolveOutcome[]).map((o) => (
                <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => { resolve.trigger({ outcome }); setShowResolve(false) }}
            className="h-9 rounded-sm bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
          >
            Continue
          </button>
        </div>
      )}

      {/* Internal case note */}
      <NoteForm kind={kind} id={id} onAdded={onChanged} />
    </div>
  )
}

// ── Internal case note (append-only, internal-only) ─────────────────────────────

function NoteForm({ kind, id, onAdded }: { kind: SafetyDetail['kind']; id: string; onAdded: () => void }) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = body.trim().length >= 10 && !submitting

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await safetyApi.addNote(kind, id, body.trim())
      setBody('')
      toast.success('Case note added.')
      onAdded()
    } catch {
      toast.error('Could not add the note.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-sm border border-slate-200 p-3 dark:border-slate-700">
      <label htmlFor="safety-note" className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
        <IoClipboardOutline className="size-3.5" /> Internal case note
      </label>
      <textarea
        id="safety-note"
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Internal only — recorded in the case history (min 10 characters)"
        className="mt-1.5 w-full resize-none rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[11px] text-slate-400">{body.trim().length}/10 minimum</span>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={cn(
            'h-8 rounded-sm px-3 text-xs font-medium transition-colors',
            canSubmit ? 'bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-600' : 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-700',
          )}
        >
          {submitting ? 'Adding…' : 'Add note'}
        </button>
      </div>
    </div>
  )
}

// ── Button ──────────────────────────────────────────────────────────────────────

const TONES: Record<string, string> = {
  amber: 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20',
  red: 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20',
  teal: 'border-teal-200 text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-400 dark:hover:bg-teal-900/20',
  slate: 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700',
}

function ActionButton({
  icon: Icon,
  label,
  tone,
  disabled,
  onClick,
  ...rest
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone: keyof typeof TONES | string
  disabled?: boolean
  onClick: () => void
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-sm border px-3 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        TONES[tone],
      )}
      {...rest}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}
