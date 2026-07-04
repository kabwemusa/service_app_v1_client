import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { IconType } from 'react-icons'

interface MetricCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: IconType
  // Positive change = teal; negative = red; neutral = grey
  trend?: { value: string; direction: 'up' | 'down' | 'neutral' }
  className?: string
  children?: ReactNode
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  className,
  children,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'rounded-sm border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
          <p className="mt-1 text-2xl font-medium text-slate-900 dark:text-slate-100 truncate">
            {value}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>
          )}
          {trend && (
            <p
              className={cn(
                'mt-1 text-xs font-medium',
                trend.direction === 'up' && 'text-teal-600',
                trend.direction === 'down' && 'text-red-500',
                trend.direction === 'neutral' && 'text-slate-400',
              )}
            >
              {trend.value}
            </p>
          )}
        </div>
        {Icon && (
          <div className="rounded-sm bg-slate-50 p-2 dark:bg-slate-700">
            <Icon className="size-5 text-slate-400 dark:text-slate-300" />
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
