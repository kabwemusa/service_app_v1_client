'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Eye, EyeOff, Lock, ShieldCheck, ExternalLink, Star,
  Calendar, Briefcase, MessageSquare, Flag, UserPlus, Banknote,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { StatusPill } from '@/components/ui/StatusPill'
import { AuditTrail } from '@/components/ui/AuditTrail'
import { Can } from '@/lib/rbac/Can'
import { toast } from '@/lib/store/toast-store'
import { cn, fmtDate, fmtDatetime, fmtPercent, fmtZMW } from '@/lib/utils'
import {
  usersApi,
  ROLE_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  type UserDetail as UserDetailType,
  type RevealedPii,
} from '@/lib/api/users'
import { UserModerationActions } from '@/components/users/UserModerationActions'
import { DenylistForm } from '@/components/users/DenylistForm'

interface Props {
  userId: string
  onChanged?: () => void
}

export function UserDetail({ userId, onChanged }: Props) {
  const qc = useQueryClient()

  const { data: user, isLoading } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => usersApi.detail(userId),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['user', userId] })
    qc.invalidateQueries({ queryKey: ['users'] })
    onChanged?.()
  }

  if (isLoading || !user) return <DetailSkeleton />

  const readOnly = user.account_status === 'suspended' || user.account_status === 'banned'

  return (
    <div className="space-y-5">
      {/* ── Identity header ── */}
      <div className="flex items-start gap-3">
        {/* Public avatar — initials fallback, NEVER the KYC selfie */}
        <Avatar name={user.display_name} src={user.avatar_url} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-medium text-slate-900 dark:text-slate-100">
            {user.display_name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusPill label={ROLE_LABEL[user.role]} variant="neutral" />
            <StatusPill label={`T${user.trust_tier} · ${user.tier_label}`} variant={user.trust_tier >= 3 ? 'verified' : 'neutral'} />
            <StatusPill label={STATUS_LABEL[user.account_status]} variant={STATUS_VARIANT[user.account_status]} />
            {user.verification_state && (
              <StatusPill label={`KYC: ${user.verification_state}`} autoVariant />
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Joined {fmtDate(user.created_at)}
            {user.last_active_at && <> · active {fmtDate(user.last_active_at)}</>}
          </p>
        </div>
      </div>

      {/* ── Read-only state banner ── */}
      {readOnly && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900/50 dark:bg-red-950/20">
          <p className="font-medium text-red-700 dark:text-red-400">
            Account {STATUS_LABEL[user.account_status].toLowerCase()}
            {user.suspended_until && (
              <> · until {fmtDate(user.suspended_until)}</>
            )}
          </p>
          {user.moderation_reason && (
            <p className="mt-1 text-red-600/90 dark:text-red-300/90">
              <span className="font-medium">Reason:</span> {user.moderation_reason}
            </p>
          )}
          <p className="mt-1 text-xs text-red-600/70 dark:text-red-300/70">
            See the full action history in the audit trail below.
          </p>
        </div>
      )}

      {/* ── Contact / PII (masked + gated reveal) ── */}
      <Section title="Contact & identity" icon={Lock}>
        <PiiBlock user={user} />
      </Section>

      {/* ── Trust signals ── */}
      <Section title="Trust signals" icon={ShieldCheck}>
        <div className="grid grid-cols-2 gap-3">
          <Signal label="Rating (§7.1)" value={user.signals.rating !== null ? `★ ${user.signals.rating.toFixed(2)} (${user.signals.reviews_count})` : 'No reviews'} />
          {user.is_provider && (
            <>
              <Signal label="Cancellation rate (§5.1)" value={user.signals.cancellation_rate !== null ? fmtPercent(user.signals.cancellation_rate) : '—'} warn={(user.signals.cancellation_rate ?? 0) > 0.1} />
              <Signal label="Response rate (§5.1)" value={user.signals.response_rate !== null ? fmtPercent(user.signals.response_rate) : '—'} />
            </>
          )}
        </div>

        {/* Internal-only composite scores — visible to read:fraud holders, never exposed outside admin */}
        {user.internal && (
          <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800/50">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Internal · admin-only
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Signal label="Trust score (§5.4)" value={user.internal.trust_score !== null ? user.internal.trust_score.toFixed(2) : '—'} />
              <Signal label="Risk score (§10.2)" value={user.internal.risk_score.toFixed(2)} warn={user.internal.risk_score > 0.5} />
            </div>
          </div>
        )}
      </Section>

      {/* ── Activity ── */}
      <Section title="Activity" icon={Calendar}>
        <div className="grid grid-cols-3 gap-2">
          <StatTile icon={Calendar} label="Bookings" value={user.activity.bookings_count} href={`/bookings?user=${user.id}`} />
          {user.is_provider && (
            <StatTile icon={Briefcase} label="Services" value={user.activity.services_count} href={`/services?provider=${user.id}`} />
          )}
          <StatTile icon={Star} label="Reviews recv." value={user.activity.reviews_received} href={`/reviews?user=${user.id}`} />
          <StatTile icon={MessageSquare} label="Reviews given" value={user.activity.reviews_given} />
          <StatTile icon={Flag} label="Reports against" value={user.activity.reports_against} href={`/safety?user=${user.id}`} warn={user.activity.reports_against > 0} />
          <StatTile icon={Flag} label="Reports filed" value={user.activity.reports_filed} />
          <StatTile icon={UserPlus} label="Referrals" value={user.activity.referrals_count} />
        </div>

        {user.activity.recent_bookings.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">Recent bookings</p>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {user.activity.recent_bookings.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-slate-700 dark:text-slate-300">{b.service_title}</p>
                    <p className="text-xs text-slate-400">
                      as {b.role} · {fmtDate(b.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-500">{fmtZMW(b.amount)}</span>
                    <StatusPill label={b.status} autoVariant />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ── DIRECT-mode advisory finance (no money moves) ── */}
      <Section title="Finance · advisory (DIRECT)" icon={Banknote}>
        <div className="grid grid-cols-2 gap-3">
          <Signal label="GMV (provider)" value={fmtZMW(user.finance.gmv)} />
          <Signal label="Commission due (uncollected)" value={fmtZMW(user.finance.commission_due_uncollected)} />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          DIRECT mode: would-be-revenue context only. No payouts or balances are settled here.
        </p>
      </Section>

      {/* ── Moderation ── */}
      <Section title="Moderation" icon={ShieldCheck}>
        <UserModerationActions user={user} onChanged={invalidate} />
        <Can do="write:denylist">
          <div className="mt-3">
            <DenylistForm user={user} onChanged={invalidate} />
          </div>
        </Can>
      </Section>

      {/* ── Audit trail (scoped to this user) ── */}
      <Section title="Audit trail" icon={ExternalLink}>
        <AuditTrail targetType="user" targetId={user.id} />
      </Section>
    </div>
  )
}

// ── PII reveal block ───────────────────────────────────────────────────────────

function PiiBlock({ user }: { user: UserDetailType }) {
  const [revealed, setRevealed] = useState<RevealedPii | null>(null)
  const [loading, setLoading] = useState(false)

  async function reveal() {
    setLoading(true)
    try {
      const pii = await usersApi.revealPii(user.id)
      setRevealed(pii)
      toast.success('Full details revealed — this access was logged.')
    } catch {
      toast.error('Could not reveal details.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <PiiRow label="Email" masked={user.contact.email_masked} revealed={revealed?.email} has={user.contact.has_email} />
      <PiiRow label="Phone" masked={user.contact.phone_masked} revealed={revealed?.phone} has={user.contact.has_phone} />
      <PiiRow label="Legal name" masked={user.contact.legal_name_masked} revealed={revealed?.legal_name} has={user.contact.has_legal_name} />
      {revealed?.momo_number && <PiiRow label="Mobile money" masked={null} revealed={revealed.momo_number} has />}

      <Can do="users.view_pii" fallback={
        <p className="text-xs text-slate-400">
          Full contact &amp; identity are masked. Revealing requires the PII-access permission.
        </p>
      }>
        {revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(null)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <EyeOff className="size-3.5" /> Hide details
          </button>
        ) : (
          <button
            type="button"
            onClick={reveal}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-600 hover:text-teal-700 disabled:opacity-50 dark:text-teal-400"
          >
            <Eye className="size-3.5" /> {loading ? 'Revealing…' : 'Reveal full details (logged)'}
          </button>
        )}
      </Can>

      <p className="text-[11px] text-slate-400">
        KYC documents are not shown here.{' '}
        {user.is_provider && (
          <Link href={`/verification?user=${user.id}`} className="text-teal-600 hover:underline dark:text-teal-400">
            Review identity in Verification →
          </Link>
        )}
      </p>
    </div>
  )
}

function PiiRow({ label, masked, revealed, has }: { label: string; masked: string | null; revealed?: string | null; has: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={cn('font-medium', revealed ? 'text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300')}>
        {!has ? <span className="text-slate-400">Not set</span> : (revealed ?? masked)}
        {revealed && <span className="ml-1.5 text-[10px] font-normal uppercase text-amber-500">shown · logged</span>}
      </span>
    </div>
  )
}

// ── Layout helpers ─────────────────────────────────────────────────────────────

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

function Signal({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={cn('text-sm font-medium', warn ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-200')}>
        {value}
      </p>
    </div>
  )
}

function StatTile({ icon: Icon, label, value, href, warn }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; href?: string; warn?: boolean }) {
  const inner = (
    <div className={cn(
      'flex flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors',
      warn ? 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10' : 'border-slate-200 dark:border-slate-700',
      href && 'hover:bg-slate-50 dark:hover:bg-slate-700/40',
    )}>
      <span className="flex items-center gap-1 text-[11px] text-slate-400">
        <Icon className="size-3" />
        {label}
        {href && <ExternalLink className="ml-auto size-2.5" />}
      </span>
      <span className={cn('text-base font-semibold', warn ? 'text-amber-700 dark:text-amber-400' : 'text-slate-800 dark:text-slate-200')}>
        {value}
      </span>
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="size-11 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  )
}
