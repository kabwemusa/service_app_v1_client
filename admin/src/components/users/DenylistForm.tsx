'use client'

import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import {
  usersApi,
  DENYLIST_CATEGORY_LABEL,
  DENYLIST_IDENTIFIER_LABEL,
  type UserDetail,
  type DenylistCategory,
  type DenylistIdentifier,
} from '@/lib/api/users'

interface Props {
  user: UserDetail
  onChanged: () => void
}

// Adds a user's identifiers to the hashed denylist (§6.4) to block re-signup.
// Only identifier KINDS are sent — the API resolves the raw value server-side
// and stores the SHA-256 hash only. Runs through the audited (step-up) wrapper.
export function DenylistForm({ user, onChanged }: Props) {
  // Offer only the kinds plausibly present on the account.
  const available: DenylistIdentifier[] = [
    ...(user.contact.has_phone ? (['PHONE_HASH'] as const) : []),
    ...(user.contact.has_email ? (['EMAIL_HASH'] as const) : []),
    ...(user.is_provider ? (['MOMO_NUMBER_HASH'] as const) : []),
  ]

  const [selected, setSelected] = useState<DenylistIdentifier[]>([])
  const [category, setCategory] = useState<DenylistCategory>('CONFIRMED_FRAUD')

  const add = useAuditedMutation<{ identifiers: DenylistIdentifier[]; category: DenylistCategory }, UserDetail>({
    capability: 'write:denylist',
    audit: {
      action: 'Add to denylist',
      targetType: 'user',
      targetId: user.id,
      summary: `Hash and add the selected identifiers of ${user.display_name} to the fraud denylist to block re-signup. Stored as one-way hashes only.`,
    },
    mutationFn: (p) =>
      usersApi.addToDenylist(user.id, { reason: p.reason, identifiers: p.identifiers, category: p.category }),
    onSuccess: () => {
      setSelected([])
      onChanged()
    },
  })

  function toggle(kind: DenylistIdentifier) {
    setSelected((s) => (s.includes(kind) ? s.filter((k) => k !== kind) : [...s, kind]))
  }

  if (available.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        No denylist-eligible identifiers are present on this account.
      </p>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50/40 p-3 dark:border-red-900/50 dark:bg-red-950/20">
      <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
        <ShieldAlert className="size-4" />
        Add to hashed denylist
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Identifiers are hashed before storage — raw values are never sent or kept. A match only flags
        future signups for review (§10.5), it does not silently reject.
      </p>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-slate-600 dark:text-slate-400">Identifiers</legend>
        {available.map((kind) => (
          <label key={kind} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={selected.includes(kind)}
              onChange={() => toggle(kind)}
              className="size-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
            />
            {DENYLIST_IDENTIFIER_LABEL[kind]}
          </label>
        ))}
      </fieldset>

      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
        Category
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as DenylistCategory)}
          className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
        >
          {(Object.keys(DENYLIST_CATEGORY_LABEL) as DenylistCategory[]).map((c) => (
            <option key={c} value={c}>
              {DENYLIST_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        disabled={selected.length === 0 || add.isPending}
        onClick={() => add.trigger({ identifiers: selected, category })}
        className={cn(
          'h-9 rounded-lg px-4 text-sm font-medium transition-colors',
          selected.length > 0 && !add.isPending
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-700',
        )}
      >
        Add to denylist
      </button>
    </div>
  )
}
