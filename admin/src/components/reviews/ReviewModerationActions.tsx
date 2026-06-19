'use client'

import { Trash2, RotateCcw, MessageSquareOff, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { reviewsApi, type ReviewDetail } from '@/lib/api/reviews'

interface Props {
  review: ReviewDetail
  onChanged: () => void
}

// Every action runs through useAuditedMutation → ConfirmWithReason (reason
// mandatory) → the API writes the state change + audit entry in one transaction.
// Buttons disable once their target state is reached (idempotent; API rejects
// no-op transitions with 409). Reviews are NEVER edited — only removed/restored.
export function ReviewModerationActions({ review, onChanged }: Props) {
  const id = review.id
  const removed = review.status === 'REMOVED'
  const hasFlags = review.flags.length > 0
  const hasResponse = !!review.response

  const ctx = (action: string, summary: string) => ({ action, targetType: 'review', targetId: id, summary })

  const remove = useAuditedMutation<Record<string, never>, ReviewDetail>({
    capability: 'reviews.moderate',
    audit: ctx(
      'Remove review',
      `Remove this review for a policy violation. This recomputes ${review.provider.name}’s Bayesian rating (§7.1). The review is hidden, not deleted — you can restore it.`,
    ),
    mutationFn: (p) => reviewsApi.remove(id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const restore = useAuditedMutation<Record<string, never>, ReviewDetail>({
    capability: 'reviews.moderate',
    audit: ctx('Restore review', `Make this review count again toward ${review.provider.name}’s rating. This recomputes it (§7.1).`),
    mutationFn: (p) => reviewsApi.restore(id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const removeResponse = useAuditedMutation<Record<string, never>, ReviewDetail>({
    capability: 'reviews.moderate',
    audit: ctx('Remove provider response', 'Remove the provider’s public reply to this review. The review itself is unchanged.'),
    mutationFn: (p) => reviewsApi.removeResponse(id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const clearFlags = useAuditedMutation<Record<string, never>, ReviewDetail>({
    capability: 'reviews.moderate',
    audit: ctx('Mark not a violation', 'Clear the flags on this review — it stays visible and is removed from the queue.'),
    mutationFn: (p) => reviewsApi.markNotViolation(id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  return (
    <Can
      do="reviews.moderate"
      fallback={<p className="text-xs text-slate-400">You have read-only access to this review.</p>}
    >
      <div className="flex flex-wrap gap-2">
        {!removed ? (
          <ActionButton icon={Trash2} label="Remove review" tone="red" disabled={remove.isPending} onClick={() => remove.trigger({})} />
        ) : (
          <ActionButton icon={RotateCcw} label="Restore review" tone="teal" disabled={restore.isPending} onClick={() => restore.trigger({})} />
        )}

        <ActionButton
          icon={ShieldCheck}
          label="Mark not a violation"
          tone="slate"
          disabled={!hasFlags || removed || clearFlags.isPending}
          onClick={() => clearFlags.trigger({})}
        />

        <ActionButton
          icon={MessageSquareOff}
          label="Remove response"
          tone="amber"
          disabled={!hasResponse || removeResponse.isPending}
          onClick={() => removeResponse.trigger({})}
        />
      </div>
    </Can>
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
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone: keyof typeof TONES | string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        TONES[tone],
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}
