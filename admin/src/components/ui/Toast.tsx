'use client'

import { useEffect } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToastStore, type ToastType } from '@/lib/store/toast-store'

const ICON: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error:   XCircle,
  warning: AlertTriangle,
  info:    Info,
}

const STYLES: Record<ToastType, string> = {
  success: 'bg-white border-teal-200 dark:bg-slate-800 dark:border-teal-700',
  error:   'bg-white border-red-200 dark:bg-slate-800 dark:border-red-700',
  warning: 'bg-white border-amber-200 dark:bg-slate-800 dark:border-amber-700',
  info:    'bg-white border-blue-200 dark:bg-slate-800 dark:border-blue-700',
}

const ICON_STYLES: Record<ToastType, string> = {
  success: 'text-teal-600',
  error:   'text-red-500',
  warning: 'text-amber-500',
  info:    'text-blue-500',
}

const DEFAULT_DURATION = 4500

function ToastItem({ id, type, message, duration = DEFAULT_DURATION }: {
  id: string
  type: ToastType
  message: string
  duration?: number
}) {
  const remove = useToastStore((s) => s.remove)
  const Icon = ICON[type]

  useEffect(() => {
    const t = setTimeout(() => remove(id), duration)
    return () => clearTimeout(t)
  }, [id, duration, remove])

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg min-w-72 max-w-sm',
        STYLES[type],
      )}
    >
      <Icon className={cn('size-4 shrink-0 mt-0.5', ICON_STYLES[type])} />
      <p className="flex-1 text-sm text-slate-700 dark:text-slate-300">{message}</p>
      <button
        onClick={() => remove(id)}
        className="shrink-0 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} />
      ))}
    </div>
  )
}
