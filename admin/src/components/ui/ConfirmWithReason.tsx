'use client'

// ─── ConfirmWithReason modal ───────────────────────────────────
// The single reusable modal for all sensitive/destructive/financial actions.
// It is registered globally in AppShell so module code never manages it.
//
// Usage: call useAuditedMutation() — the hook drives this modal automatically.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import { IoWarningOutline, IoShieldCheckmarkOutline, IoCloseOutline } from 'react-icons/io5'
import { cn } from '@/lib/utils'
import { _registerConfirmHandler, type PendingMutation } from '@/lib/audit/audited-mutation'

export function ConfirmWithReasonModal() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pending, setPending] = useState<PendingMutation<any> | null>(null)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Register the global setter so useAuditedMutation can open this modal
  useEffect(() => {
    _registerConfirmHandler(setPending)
  }, [])

  useEffect(() => {
    if (pending) {
      setReason('')
      setSubmitting(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [pending])

  if (!pending) return null

  const canSubmit = reason.trim().length >= 10 && !submitting

  async function handleConfirm() {
    if (!canSubmit || !pending) return
    setSubmitting(true)
    await pending.onConfirm(reason.trim())
  }

  function handleCancel() {
    pending?.onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleCancel}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md rounded-sm border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <div className="flex items-center gap-3">
            {pending.requiresStepUp ? (
              <IoShieldCheckmarkOutline className="size-5 text-amber-500 shrink-0" />
            ) : (
              <IoWarningOutline className="size-5 text-amber-500 shrink-0" />
            )}
            <div>
              <h2
                id="confirm-title"
                className="text-sm font-medium text-slate-900 dark:text-slate-100"
              >
                Confirm: {pending.audit.action}
              </h2>
              {pending.requiresStepUp && (
                <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                  This action requires step-up authentication
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="rounded-sm p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
            aria-label="Cancel"
          >
            <IoCloseOutline className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {pending.audit.summary}
          </p>

          <div className="space-y-1.5">
            <label
              htmlFor="confirm-reason"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              ref={textareaRef}
              id="confirm-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe why you are taking this action (min 10 characters)"
              className={cn(
                'w-full resize-none rounded-sm border px-3 py-2 text-sm',
                'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400',
                'dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500',
                'focus:outline-none focus:ring-2 focus:ring-teal-500',
              )}
            />
            <p className="text-xs text-slate-400">
              {reason.trim().length}/10 characters minimum
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-700">
          <button
            onClick={handleCancel}
            className="rounded-sm px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className={cn(
              'rounded-sm px-4 py-2 text-sm font-medium transition-colors',
              canSubmit
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-700',
            )}
          >
            {submitting ? 'Processing…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
