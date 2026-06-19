'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useRef, type ReactNode } from 'react'

interface DetailPanelProps {
  title: string
  subtitle?: string
  open: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg' | 'xl'
}

const WIDTH_CLASSES = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
}

// Right-side slide-over panel for record detail / evidence / timeline views.
// The backdrop click closes the panel; Escape key is handled below.
export function DetailPanel({
  title,
  subtitle,
  open,
  onClose,
  children,
  footer,
  width = 'lg',
}: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape to dismiss + focus management. The panel is focus-trapped while open
  // and restores focus to the previously focused element on close.
  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    function focusable(): HTMLElement[] {
      if (!panelRef.current) return []
      return Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      )
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    // Move focus into the panel on open
    const items = focusable()
    ;(items[0] ?? panelRef.current)?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          'relative ml-auto flex h-full w-full flex-col bg-white',
          'dark:bg-slate-900',
          WIDTH_CLASSES[width],
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-base font-medium text-slate-900 dark:text-slate-100">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label="Close panel"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {/* Optional footer */}
        {footer && (
          <div className="shrink-0 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
