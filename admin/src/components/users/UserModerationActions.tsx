'use client'

import { useState } from 'react'
import { IoWarningOutline, IoBanOutline, IoPauseCircleOutline, IoArrowUndoOutline, IoSwapVerticalOutline } from 'react-icons/io5'
import { cn } from '@/lib/utils'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { usersApi, TIER_LABEL, type UserDetail } from '@/lib/api/users'
import type { TrustTier } from '@/lib/api/types'

interface Props {
  user: UserDetail
  onChanged: () => void
}

// Every action here runs through useAuditedMutation → ConfirmWithReason (reason
// mandatory) → the API writes the state change + audit entry in one transaction.
// Buttons disable once their target state is reached (idempotent; the API also
// rejects no-op transitions with 409).
export function UserModerationActions({ user, onChanged }: Props) {
  const id = user.id
  const status = user.account_status

  const ctx = (action: string, summary: string) => ({
    action,
    targetType: 'user',
    targetId: id,
    summary,
  })

  const warn = useAuditedMutation<Record<string, never>, UserDetail>({
    capability: 'users.moderate',
    audit: ctx('Warn user', `Send a formal warning notice to ${user.display_name}. The account stays active.`),
    mutationFn: (p) => usersApi.warn(id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const suspend = useAuditedMutation<{ duration_days: number | null }, UserDetail>({
    capability: 'users.moderate',
    audit: ctx('Suspend user', `Temporarily suspend ${user.display_name} — blocks listing and booking until reinstated or the period lapses.`),
    mutationFn: (p) => usersApi.suspend(id, { reason: p.reason, duration_days: p.duration_days }),
    onSuccess: onChanged,
  })

  const ban = useAuditedMutation<Record<string, never>, UserDetail>({
    capability: 'ban:users',
    audit: ctx('Ban user', `Permanently ban ${user.display_name}. Tier resets to 0. This requires step-up authentication.`),
    mutationFn: (p) => usersApi.ban(id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const reinstate = useAuditedMutation<Record<string, never>, UserDetail>({
    capability: 'users.moderate',
    audit: ctx('Reinstate user', `Restore ${user.display_name} to active status and clear any warning or suspension.`),
    mutationFn: (p) => usersApi.reinstate(id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const adjustTier = useAuditedMutation<{ tier: number }, UserDetail>({
    capability: 'users.adjust_tier',
    audit: ctx('Adjust tier', `Manually set ${user.display_name}'s trust tier. Use the Verification module for KYC review.`),
    mutationFn: (p) => usersApi.adjustTier(id, { reason: p.reason, tier: p.tier }),
    onSuccess: onChanged,
  })

  const [duration, setDuration] = useState<number | ''>(7)
  const [showSuspend, setShowSuspend] = useState(false)
  const [showTier, setShowTier] = useState(false)
  const [tierValue, setTierValue] = useState<TrustTier>(user.trust_tier)

  const canWarn = status === 'active'
  const canSuspend = status !== 'suspended' && status !== 'banned'
  const canBan = status !== 'banned'
  const canReinstate = status !== 'active'

  return (
    <div className="space-y-3">
      <Can any={['users.moderate', 'ban:users', 'users.adjust_tier']} fallback={
        <p className="text-xs text-slate-400">You have read-only access to this record.</p>
      }>
        <div className="flex flex-wrap gap-2">
          <Can do="users.moderate">
            <ActionButton
              icon={IoWarningOutline}
              label="Warn"
              tone="amber"
              disabled={!canWarn || warn.isPending}
              onClick={() => warn.trigger({})}
            />
            <ActionButton
              icon={IoPauseCircleOutline}
              label="Suspend"
              tone="amber"
              disabled={!canSuspend || suspend.isPending}
              onClick={() => setShowSuspend((s) => !s)}
              aria-expanded={showSuspend}
            />
          </Can>

          <Can do="ban:users">
            <ActionButton
              icon={IoBanOutline}
              label="Ban"
              tone="red"
              disabled={!canBan || ban.isPending}
              onClick={() => ban.trigger({})}
            />
          </Can>

          <Can do="users.moderate">
            <ActionButton
              icon={IoArrowUndoOutline}
              label="Reinstate"
              tone="teal"
              disabled={!canReinstate || reinstate.isPending}
              onClick={() => reinstate.trigger({})}
            />
          </Can>

          {user.is_provider && (
            <Can do="users.adjust_tier">
              <ActionButton
                icon={IoSwapVerticalOutline}
                label="Adjust tier"
                tone="slate"
                disabled={adjustTier.isPending}
                onClick={() => setShowTier((s) => !s)}
                aria-expanded={showTier}
              />
            </Can>
          )}
        </div>
      </Can>

      {/* Suspend duration sub-form */}
      {showSuspend && (
        <Can do="users.moderate">
          <div className="flex flex-wrap items-end gap-2 rounded-sm border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Duration
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 block h-9 rounded-sm border border-slate-200 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value="">Indefinite</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                suspend.trigger({ duration_days: duration === '' ? null : duration })
                setShowSuspend(false)
              }}
              className="h-9 rounded-sm bg-amber-600 px-4 text-sm font-medium text-white hover:bg-amber-700"
            >
              Continue
            </button>
          </div>
        </Can>
      )}

      {/* Tier adjust sub-form */}
      {showTier && user.is_provider && (
        <Can do="users.adjust_tier">
          <div className="flex flex-wrap items-end gap-2 rounded-sm border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              New tier
              <select
                value={tierValue}
                onChange={(e) => setTierValue(Number(e.target.value) as TrustTier)}
                className="mt-1 block h-9 rounded-sm border border-slate-200 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
              >
                {([0, 1, 2, 3, 4] as const).map((t) => (
                  <option key={t} value={t}>
                    Tier {t} · {TIER_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={tierValue === user.trust_tier}
              onClick={() => {
                adjustTier.trigger({ tier: tierValue })
                setShowTier(false)
              }}
              className="h-9 rounded-sm bg-slate-700 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-600"
            >
              Continue
            </button>
            <p className="w-full text-xs text-slate-400">
              For KYC-based tier grants, use the Verification module instead — this is a manual override.
            </p>
          </div>
        </Can>
      )}
    </div>
  )
}

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
        'disabled:cursor-not-allowed disabled:opacity-40',
        TONES[tone],
      )}
      {...rest}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}
