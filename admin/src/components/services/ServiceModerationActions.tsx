'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IoEyeOffOutline, IoArrowUndoOutline, IoFolderOpenOutline } from 'react-icons/io5'
import { cn } from '@/lib/utils'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { servicesApi, type ServiceDetail } from '@/lib/api/services'
import { categoriesApi, bandLabel, type AdminCategory } from '@/lib/api/categories'

interface Props {
  service: ServiceDetail
  onChanged: () => void
}

// §8.1 valid commission bands (mirror of COMMISSION_BANDS values).
const VALID_BANDS = ['standard', 'micro', 'skilled', 'professional', 'high_risk']

// Every action runs through useAuditedMutation → ConfirmWithReason (reason
// mandatory) → the API writes the state change + audit entry in one transaction.
// Buttons disable once their target state is reached (idempotent; the API also
// rejects no-op transitions with 409).
export function ServiceModerationActions({ service, onChanged }: Props) {
  const id = service.id
  const status = service.status

  const ctx = (action: string, summary: string) => ({
    action,
    targetType: 'service',
    targetId: id,
    summary,
  })

  const hide = useAuditedMutation<Record<string, never>, ServiceDetail>({
    capability: 'services.moderate',
    audit: ctx('Hide / take down listing', `Remove "${service.title}" from discovery. The reason is shown to the provider. In-flight bookings are unaffected.`),
    mutationFn: (p) => servicesApi.hide(id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const requireChanges = useAuditedMutation<Record<string, never>, ServiceDetail>({
    capability: 'services.moderate',
    audit: ctx('Require changes', `Send "${service.title}" back to the provider as a draft with your notes. They edit and re-publish.`),
    mutationFn: (p) => servicesApi.requireChanges(id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const restore = useAuditedMutation<Record<string, never>, ServiceDetail>({
    capability: 'services.moderate',
    audit: ctx('Restore listing', `Return "${service.title}" to active and visible in discovery.`),
    mutationFn: (p) => servicesApi.restore(id, { reason: p.reason }),
    onSuccess: onChanged,
  })

  const reassign = useAuditedMutation<{ category_id: number }, ServiceDetail>({
    capability: 'services.moderate',
    audit: ctx('Reassign category', `Move "${service.title}" to a different category. The new category must reference a valid §8.1 commission band.`),
    mutationFn: (p) => servicesApi.reassignCategory(id, { category_id: p.category_id, reason: p.reason }),
    onSuccess: onChanged,
  })

  const [showReassign, setShowReassign] = useState(false)

  const canHide = status !== 'HIDDEN'
  const canRequire = status !== 'DRAFT'
  const canRestore = status !== 'ACTIVE'

  return (
    <Can
      do="services.moderate"
      fallback={<p className="text-xs text-slate-400">You have read-only access to this listing.</p>}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <ActionButton
            icon={IoEyeOffOutline}
            label="Hide / take down"
            tone="red"
            disabled={!canHide || hide.isPending}
            onClick={() => hide.trigger({})}
          />
          <ActionButton
            icon={IoArrowUndoOutline}
            label="Require changes"
            tone="amber"
            disabled={!canRequire || requireChanges.isPending}
            onClick={() => requireChanges.trigger({})}
          />
          <ActionButton
            icon={IoArrowUndoOutline}
            label="Restore"
            tone="teal"
            disabled={!canRestore || restore.isPending}
            onClick={() => restore.trigger({})}
          />
          <ActionButton
            icon={IoFolderOpenOutline}
            label="Reassign category"
            tone="slate"
            disabled={reassign.isPending}
            onClick={() => setShowReassign((s) => !s)}
            aria-expanded={showReassign}
          />
        </div>

        {showReassign && (
          <ReassignForm
            currentCategoryId={service.category?.id ?? null}
            onSubmit={(categoryId) => {
              reassign.trigger({ category_id: categoryId })
              setShowReassign(false)
            }}
          />
        )}
      </div>
    </Can>
  )
}

// ── Reassign sub-form ───────────────────────────────────────────────────────

function ReassignForm({
  currentCategoryId,
  onSubmit,
}: {
  currentCategoryId: number | null
  onSubmit: (categoryId: number) => void
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  })

  const [value, setValue] = useState<number | ''>('')

  // Only banded categories are valid reassignment targets (§8.1). Flatten the
  // admin tree to leaf categories carrying a valid band.
  const options = flattenBanded(data?.data ?? [])

  if (isError) {
    return (
      <div className="rounded-sm border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
        Category list unavailable — your role can moderate services but cannot read the category
        catalogue. Ask a moderator or super-admin to reassign.
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-sm border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
      <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
        Move to category (banded only)
        <select
          value={value}
          onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))}
          disabled={isLoading}
          className="mt-1 block h-9 w-64 rounded-sm border border-slate-200 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
        >
          <option value="">{isLoading ? 'Loading…' : 'Select a category…'}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={o.id === currentCategoryId}>
              {o.label} · {bandLabel(o.commission_band)}
              {o.id === currentCategoryId ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={value === '' || value === currentCategoryId}
        onClick={() => value !== '' && onSubmit(value)}
        className="h-9 rounded-sm bg-slate-700 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-600"
      >
        Continue
      </button>
    </div>
  )
}

interface BandedOption {
  id: number
  label: string
  commission_band: string | null
}

function flattenBanded(tree: AdminCategory[]): BandedOption[] {
  const out: BandedOption[] = []
  const walk = (nodes: AdminCategory[], prefix: string) => {
    for (const n of nodes) {
      const label = prefix ? `${prefix} › ${n.name}` : n.name
      if (n.commission_band && VALID_BANDS.includes(n.commission_band)) {
        out.push({ id: n.id, label, commission_band: n.commission_band })
      }
      if (n.children?.length) walk(n.children, label)
    }
  }
  walk(tree, '')
  return out
}

// ── Button ──────────────────────────────────────────────────────────────────

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
