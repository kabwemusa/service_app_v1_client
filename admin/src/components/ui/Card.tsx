import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CardProps {
  children: ReactNode
  className?: string
  /** Set false for list/section cards whose rows pad themselves (split by <Divider />). */
  padded?: boolean
}

/**
 * Canonical content container (v3.1 §2 design language).
 *
 *   • flat white surface, hairline border, small radius (rounded-lg = 8px)
 *   • NO drop shadow / elevation / glow
 *   • sits on the page background with a consistent gap between cards
 *
 * The ONLY content container in the admin app — compose pages from it and never
 * nest a Card inside a Card. Use <Divider /> to split rows/sub-sections inside.
 */
export function Card({ children, className, padded = true }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface DividerProps {
  className?: string
}

/** Hairline separator for rows/sub-sections INSIDE a Card (v3.1 §2). */
export function Divider({ className }: DividerProps) {
  return <div className={cn('h-px bg-slate-200 dark:bg-slate-700', className)} />
}
