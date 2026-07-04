import { cn } from '@/lib/utils'
import type { AdminRole } from '@/lib/api/types'

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin:  'Super admin',
  trust_safety: 'Trust & safety',
  finance:      'Finance',
  moderator:    'Moderator',
  support:      'Support',
  analyst:      'Analyst',
  ops:          'Ops',
}

const ROLE_CLASSES: Record<AdminRole, string> = {
  super_admin:  'bg-teal-50 text-teal-700 border-teal-200',
  trust_safety: 'bg-amber-50 text-amber-700 border-amber-200',
  finance:      'bg-green-50 text-green-700 border-green-200',
  moderator:    'bg-blue-50 text-blue-700 border-blue-200',
  support:      'bg-slate-50 text-slate-600 border-slate-200',
  analyst:      'bg-purple-50 text-purple-700 border-purple-200',
  ops:          'bg-orange-50 text-orange-700 border-orange-200',
}

interface RoleBadgeProps {
  role: AdminRole
  className?: string
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        ROLE_CLASSES[role],
        className,
      )}
    >
      {ROLE_LABEL[role]}
    </span>
  )
}

export { ROLE_LABEL }
