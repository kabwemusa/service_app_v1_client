'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusPill, type StatusVariant } from '@/components/ui/StatusPill'
import { fmtRelative } from '@/lib/utils'

export interface QueueItem {
  id: string
  title: string
  subtitle?: string
  timestamp: string
  status?: string
  statusVariant?: StatusVariant
  slaBreached?: boolean
  meta?: string
}

interface QueueListProps<T extends QueueItem> {
  items: T[]
  isLoading?: boolean
  emptyMessage?: string
  onSelect?: (item: T) => void
  selectedId?: string
  renderExtra?: (item: T) => ReactNode
  className?: string
}

const SKELETON_COUNT = 6

export function QueueList<T extends QueueItem>({
  items,
  isLoading = false,
  emptyMessage = 'Queue is empty.',
  onSelect,
  selectedId,
  renderExtra,
  className,
}: QueueListProps<T>) {
  if (isLoading) {
    return (
      <div className={cn('divide-y divide-slate-100 dark:divide-slate-800', className)}>
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div key={i} className="flex gap-3 px-4 py-3">
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100 dark:bg-slate-700" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return <EmptyState title={emptyMessage} className={className} />
  }

  return (
    <div
      className={cn(
        'divide-y divide-slate-100 dark:divide-slate-800',
        className,
      )}
      role="list"
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="listitem"
          onClick={() => onSelect?.(item)}
          className={cn(
            'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors',
            'hover:bg-slate-50 dark:hover:bg-slate-700/40',
            selectedId === item.id && 'bg-teal-50 dark:bg-teal-900/20',
            item.slaBreached && 'border-l-2 border-amber-400',
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p
                className={cn(
                  'truncate text-sm font-medium',
                  item.slaBreached
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-slate-800 dark:text-slate-200',
                )}
              >
                {item.title}
              </p>
              {item.status && (
                <StatusPill label={item.status} variant={item.statusVariant} />
              )}
            </div>
            {item.subtitle && (
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {item.subtitle}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {fmtRelative(item.timestamp)}
              {item.meta && ` · ${item.meta}`}
            </p>
          </div>
          {renderExtra?.(item)}
        </button>
      ))}
    </div>
  )
}
