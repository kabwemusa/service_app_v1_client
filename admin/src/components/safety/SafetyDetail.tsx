'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Shield, AlertOctagon, AlertTriangle, Lock, Eye, EyeOff, ExternalLink,
  Calendar, Flag, Scale, FileText, MapPin, Clock, ShieldAlert, UserCog,
} from 'lucide-react'
import { StatusPill } from '@/components/ui/StatusPill'
import { AuditTrail } from '@/components/ui/AuditTrail'
import { Can } from '@/lib/rbac/Can'
import { toast } from '@/lib/store/toast-store'
import { cn, fmtDatetime, fmtRelative, fmtZMW } from '@/lib/utils'
import {
  STATUS_LABEL as ACCOUNT_STATUS_LABEL,
  STATUS_VARIANT as ACCOUNT_STATUS_VARIANT,
} from '@/lib/api/users'
import {
  safetyApi,
  SEVERITY_LABEL,
  STATUS_LABEL,
  OUTCOME_LABEL,
  type SafetyKind,
  type SafetyDetail as SafetyDetailType,
  type Party,
  type RevealedParties,
} from '@/lib/api/safety'
import { SafetyActions } from '@/components/safety/SafetyActions'

interface Props {
  kind: SafetyKind
  id: string
  onChanged?: () => void
}

export function SafetyDetail({ kind, id, onChanged }: Props) {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['safety-detail', kind, id],
    queryFn: () => safetyApi.detail(kind, id),
  })

  const [revealed, setRevealed] = useState<RevealedParties | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['safety-detail', kind, id] })
    qc.invalidateQueries({ queryKey: ['safety-queue'] })
    onChanged?.()
  }

  if (isLoading || !data) return <DetailSkeleton />

  const isEmergency = data.kind === 'emergency'
  const isResolved = data.status === 'resolved'
  const targetType = isEmergency ? 'emergency_event' : 'safety_report'

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={data.severity} />
          <StatusPill label={STATUS_LABEL[data.status]} autoVariant />
          {data.assigned?.admin_name && (
            <StatusPill label={`Investigating · ${data.assigned.admin_name}`} variant="info" />
          )}
          {data.super_admin_escalated && (
            <StatusPill label="Escalated to super admin" variant="warning" />
          )}
          {data.contact_restricted && (
            <StatusPill label="Contact restricted" variant="restricted" />
          )}
          {data.authority_escalated_at && (
            <StatusPill label="Authority escalation recorded" variant="danger" />
          )}
        </div>
        <h3 className="mt-2 text-base font-medium text-slate-900 dark:text-slate-100">
          {isEmergency ? 'In-app emergency event (§11.4)' : data.category_label}
        </h3>
        <p className="text-xs text-slate-400">
          {isEmergency
            ? <>Triggered {data.created_at ? fmtRelative(data.created_at) : '—'}</>
            : <>Reported {data.reported_at ? fmtRelative(data.reported_at) : '—'}</>}
        </p>
      </div>

      {/* ── Confidentiality notice (always) ── */}
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
        <Lock className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        <p>
          Reporter identity is confidential and must never be shared with the reported party. Contact
          and identity are masked below; revealing them is recorded in the audit log. This module
          records protective decisions — it does not contact authorities itself.
        </p>
      </div>

      {/* ── Resolved (read-only) banner ── */}
      {isResolved && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm dark:border-teal-900/50 dark:bg-teal-950/20">
          <p className="font-medium text-teal-700 dark:text-teal-400">
            Resolved{data.outcome && <> · {OUTCOME_LABEL[data.outcome]}</>}
            {data.reviewed_by_admin_name && <> by {data.reviewed_by_admin_name}</>}
          </p>
          {data.review_notes && (
            <p className="mt-1 text-teal-700/90 dark:text-teal-300/90">{data.review_notes}</p>
          )}
          <p className="mt-1 text-xs text-teal-600/70 dark:text-teal-300/70">
            This record is closed and read-only. See the full action history below.
          </p>
        </div>
      )}

      {/* ── Emergency context ── */}
      {isEmergency && (
        <Section title="Emergency context" icon={AlertOctagon}>
          <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm dark:border-red-900/50 dark:bg-red-950/20">
            <Row icon={MapPin} label="Location context" value={data.location_label ?? 'Not shared'} />
            <Row
              icon={Clock}
              label="Post-incident outreach due (§11.4)"
              value={data.outreach_due_at ? fmtDatetime(data.outreach_due_at) : 'Not set'}
            />
          </div>
        </Section>
      )}

      {/* ── Report content ── */}
      {!isEmergency && data.description && (
        <Section title="Report content" icon={FileText}>
          <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
            {data.description}
          </p>
        </Section>
      )}

      {/* ── Parties (PII masked + gated reveal) ── */}
      <Section title="Parties" icon={Shield}>
        <div className="space-y-3">
          {data.reporter && (
            <PartyCard party={data.reporter} revealed={revealed?.reporter ?? null} />
          )}
          {data.reported && (
            <PartyCard party={data.reported} revealed={revealed?.reported ?? null} />
          )}

          <Can do="safety.handle" fallback={
            <p className="text-xs text-slate-400">Contact &amp; identity stay masked without the safety permission.</p>
          }>
            {revealed ? (
              <button
                type="button"
                onClick={() => setRevealed(null)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                <EyeOff className="size-3.5" /> Hide identities
              </button>
            ) : (
              <RevealButton kind={kind} id={id} onRevealed={setRevealed} />
            )}
          </Can>
        </div>
      </Section>

      {/* ── Booking context ── */}
      {data.booking && (
        <Section title="Booking context" icon={Calendar}>
          <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                {data.booking.service_title}
              </p>
              <StatusPill label={data.booking.status} autoVariant />
            </div>
            <Row icon={Clock} label="Scheduled" value={data.booking.scheduled_start ? fmtDatetime(data.booking.scheduled_start) : 'Not scheduled'} />
            <Row icon={MapPin} label="Location" value={[data.booking.location_label, data.booking.location_region].filter(Boolean).join(', ') || 'Not set'} />
            <Row icon={FileText} label="Amount" value={fmtZMW(data.booking.amount)} />
            <Link href={`/bookings?booking=${data.booking.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">
              Open booking <ExternalLink className="size-3" />
            </Link>
          </div>
        </Section>
      )}

      {/* ── Actions ── */}
      {!isResolved && (
        <Section title="Actions" icon={UserCog}>
          <SafetyActions detail={data} onChanged={invalidate} />
        </Section>
      )}

      {/* ── Audit trail (incl. internal case notes) ── */}
      <Section title="Case history & notes" icon={Scale}>
        <AuditTrail targetType={targetType} targetId={id} />
      </Section>
    </div>
  )
}

// ── Party card ──────────────────────────────────────────────────────────────────

function PartyCard({ party, revealed }: { party: Party; revealed: RevealedParties['reporter'] }) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        party.is_reporter
          ? 'border-amber-200 bg-amber-50/50 dark:border-amber-800/60 dark:bg-amber-900/10'
          : 'border-slate-200 dark:border-slate-700',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {party.is_reporter ? 'Reporter' : 'Reported'}
          </span>
          {party.is_reporter && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <Lock className="size-2.5" aria-hidden="true" /> confidential
            </span>
          )}
        </div>
        <StatusPill
          label={ACCOUNT_STATUS_LABEL[party.account_status]}
          variant={ACCOUNT_STATUS_VARIANT[party.account_status]}
        />
      </div>

      <p className="mt-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
        {party.display_masked ?? '—'}{' '}
        <span className="text-xs font-normal text-slate-400">· {party.role_label}</span>
      </p>

      {/* Masked / revealed contact */}
      <div className="mt-2 space-y-1">
        <ContactRow label="Email" masked={party.contact.email_masked} revealed={revealed?.email} has={party.contact.has_email} />
        <ContactRow label="Phone" masked={party.contact.phone_masked} revealed={revealed?.phone} has={party.contact.has_phone} />
        <ContactRow label="Legal name" masked={party.contact.legal_name_masked} revealed={revealed?.legal_name} has={party.contact.has_legal_name} />
      </div>

      {/* History / standing */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className={cn(party.history.reports_against > 0 && 'text-amber-600 dark:text-amber-400')}>
          <Flag className="mr-0.5 inline size-3" aria-hidden="true" />
          {party.history.reports_against} report{party.history.reports_against === 1 ? '' : 's'} against
        </span>
        <span>{party.history.reports_filed} filed</span>
        <span className={cn(party.history.open_disputes > 0 && 'text-amber-600 dark:text-amber-400')}>
          {party.history.open_disputes} open dispute{party.history.open_disputes === 1 ? '' : 's'}
        </span>
      </div>

      <Link
        href={`/users?user=${party.user_id}`}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400"
      >
        Open in Users <ExternalLink className="size-3" />
      </Link>
    </div>
  )
}

function RevealButton({ kind, id, onRevealed }: { kind: SafetyKind; id: string; onRevealed: (r: RevealedParties) => void }) {
  const [loading, setLoading] = useState(false)
  async function reveal() {
    setLoading(true)
    try {
      const r = await safetyApi.revealPii(kind, id)
      onRevealed(r)
      toast.success('Identities revealed — this access was logged.')
    } catch {
      toast.error('Could not reveal identities.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <button
      type="button"
      onClick={reveal}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-600 hover:text-teal-700 disabled:opacity-50 dark:text-teal-400"
    >
      <Eye className="size-3.5" /> {loading ? 'Revealing…' : 'Reveal identities (logged)'}
    </button>
  )
}

function ContactRow({ label, masked, revealed, has }: { label: string; masked: string | null; revealed?: string | null; has: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={cn('font-medium', revealed ? 'text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300')}>
        {!has ? <span className="text-slate-400">Not set</span> : (revealed ?? masked)}
        {revealed && <span className="ml-1.5 text-[10px] font-normal uppercase text-amber-500" aria-label="shown and logged">shown · logged</span>}
      </span>
    </div>
  )
}

// ── Layout helpers ───────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: SafetyDetailType['severity'] }) {
  const map = {
    EMERGENCY: { icon: AlertOctagon, cls: 'bg-red-600 text-white' },
    HIGH: { icon: AlertTriangle, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
    STANDARD: { icon: ShieldAlert, cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  } as const
  const m = map[severity]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', m.cls)}>
      <m.icon className="size-3.5" aria-hidden="true" />
      {SEVERITY_LABEL[severity]}
    </span>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <Icon className="size-3.5" />
        <span>{title}</span>
      </h4>
      {children}
    </section>
  )
}

function Row({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
        <Icon className="size-3.5 text-slate-400" /> {label}
      </span>
      <span className="text-right font-medium text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-2/3 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
      <div className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  )
}
