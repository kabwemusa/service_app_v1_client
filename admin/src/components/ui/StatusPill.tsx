import { cn } from '@/lib/utils'

export type StatusVariant =
  | 'active' | 'verified' | 'completed' | 'approved' | 'disbursed'
  | 'pending' | 'warning' | 'restricted' | 'grace' | 'under_review' | 'manual_review'
  | 'danger' | 'banned' | 'suspended' | 'rejected' | 'cancelled'
  | 'neutral' | 'inactive' | 'draft' | 'paused'
  | 'info'

const VARIANT_CLASSES: Record<StatusVariant, string> = {
  // Trust / positive
  active:       'bg-teal-50 text-teal-700 border-teal-200',
  verified:     'bg-teal-50 text-teal-700 border-teal-200',
  completed:    'bg-teal-50 text-teal-700 border-teal-200',
  approved:     'bg-teal-50 text-teal-700 border-teal-200',
  disbursed:    'bg-teal-50 text-teal-700 border-teal-200',
  // Attention / amber
  pending:      'bg-amber-50 text-amber-700 border-amber-200',
  warning:      'bg-amber-50 text-amber-700 border-amber-200',
  restricted:   'bg-amber-50 text-amber-700 border-amber-200',
  grace:        'bg-amber-50 text-amber-700 border-amber-200',
  under_review: 'bg-amber-50 text-amber-700 border-amber-200',
  manual_review:'bg-amber-50 text-amber-700 border-amber-200',
  // Danger / red
  danger:       'bg-red-50 text-red-700 border-red-200',
  banned:       'bg-red-50 text-red-700 border-red-200',
  suspended:    'bg-red-50 text-red-700 border-red-200',
  rejected:     'bg-red-50 text-red-700 border-red-200',
  cancelled:    'bg-red-50 text-red-700 border-red-200',
  // Neutral
  neutral:      'bg-slate-50 text-slate-600 border-slate-200',
  inactive:     'bg-slate-50 text-slate-500 border-slate-200',
  draft:        'bg-slate-50 text-slate-500 border-slate-200',
  paused:       'bg-slate-50 text-slate-500 border-slate-200',
  // Info
  info:         'bg-blue-50 text-blue-700 border-blue-200',
}

// Map common status strings to a variant automatically
export function statusToVariant(status: string): StatusVariant {
  const s = status.toLowerCase().replace(/[^a-z_]/g, '_')
  if (s in VARIANT_CLASSES) return s as StatusVariant
  if (['active', 'completed', 'approved', 'disbursed', 'verified'].includes(s)) return 'active'
  if (['pending', 'awaiting_evidence', 'awaiting_kyc', 'funds_held', 'in_progress', 'submitted'].includes(s)) return 'pending'
  if (['banned', 'rejected', 'suspended', 'cancelled'].includes(s)) return 'danger'
  if (['restricted', 'manual_review', 'under_review', 'disputed', 'chargeback_pending'].includes(s)) return 'warning'
  return 'neutral'
}

interface StatusPillProps {
  label: string
  variant?: StatusVariant
  // Auto-detect variant from label if variant not supplied
  autoVariant?: boolean
  className?: string
}

export function StatusPill({ label, variant, autoVariant = true, className }: StatusPillProps) {
  const v = variant ?? (autoVariant ? statusToVariant(label) : 'neutral')
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        VARIANT_CLASSES[v],
        className,
      )}
    >
      {label}
    </span>
  )
}
