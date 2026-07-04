import type { IconType } from 'react-icons'
import { IoFileTrayOutline } from 'react-icons/io5'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: string
  icon?: IconType
  action?: ReactNode
  className?: string
}

export function EmptyState({
  title,
  description,
  icon: Icon = IoFileTrayOutline,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-slate-200 bg-slate-50 py-16 text-center dark:border-slate-700 dark:bg-slate-800/50',
        className,
      )}
    >
      <Icon className="size-8 text-slate-300 dark:text-slate-600" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{title}</p>
        {description && (
          <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
