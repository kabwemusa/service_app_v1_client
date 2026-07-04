'use client'

import { cn } from '@/lib/utils'

export interface TabBarItem<T extends string> {
  value: T
  label: string
}

interface TabBarProps<T extends string> {
  items: TabBarItem<T>[]
  active: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}

/** Same underline-tab pattern already used ad hoc in ReviewsManager/SafetyManager — promoted to a shared primitive. */
export function TabBar<T extends string>({ items, active, onChange, ariaLabel, className }: TabBarProps<T>) {
  return (
    <div
      className={cn('flex gap-1 border-b border-slate-200 dark:border-slate-700', className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={active === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            active === item.value
              ? 'border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
