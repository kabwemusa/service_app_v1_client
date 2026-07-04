'use client'

import { IoSearchOutline, IoCloseOutline } from 'react-icons/io5'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface FilterOption {
  value: string
  label: string
}

interface FilterBarProps {
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  filters?: Array<{
    key: string
    label: string
    options: FilterOption[]
    value: string
    onChange: (value: string) => void
  }>
  actions?: ReactNode
  className?: string
}

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filters = [],
  actions,
  className,
}: FilterBarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2',
        className,
      )}
    >
      {/* Search */}
      {onSearchChange && (
        <div className="relative flex-1 min-w-48">
          <IoSearchOutline className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className={cn(
              'h-9 w-full rounded-sm border border-slate-200 bg-white pl-9 pr-3 text-sm',
              'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500',
              'dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500',
            )}
          />
        </div>
      )}

      {/* Selects */}
      {filters.map((f) => (
        <div key={f.key} className="relative flex items-center">
          <select
            id={`filter-${f.key}`}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
            aria-label={f.label}
            className={cn(
              'h-9 appearance-none rounded-sm border border-slate-200 bg-white pl-3 pr-8 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-teal-500',
              'dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100',
              f.value && 'border-teal-400 text-teal-700 dark:border-teal-500',
            )}
          >
            <option value="">{f.label}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {f.value && (
            <button
              onClick={() => f.onChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label={`Clear ${f.label}`}
            >
              <IoCloseOutline className="size-3.5" />
            </button>
          )}
        </div>
      ))}

      {/* Right-side actions (e.g. export button) */}
      {actions && <div className="ml-auto">{actions}</div>}
    </div>
  )
}
