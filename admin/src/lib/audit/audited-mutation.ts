'use client'

// ─── Audited mutation pattern ─────────────────────────────────────────────────
//
// Every sensitive/destructive/financial action MUST go through this wrapper.
// It is the ONLY sanctioned way to perform a state-changing admin operation.
//
// Flow:
//   1. Module calls useAuditedMutation({ action, targetType, targetId })
//   2. The hook returns a trigger function
//   3. Caller invokes trigger() — this opens ConfirmWithReason modal
//   4. Admin fills in the required reason and confirms
//   5. The hook calls the mutationFn with { reason } appended to the payload
//   6. The Laravel API executes the DB mutation + writes audit log in ONE transaction
//   7. Hook calls onSuccess / onError; shows toast
//
// Module authors never construct audit log entries directly.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react'
import { toast } from '@/lib/store/toast-store'
import { needsStepUp } from '@/lib/rbac/permissions'
import type { Capability } from '@/lib/api/types'

export interface AuditContext {
  action: string
  targetType: string
  targetId: string
  // Human-readable summary shown in the ConfirmWithReason modal
  summary: string
}

export interface AuditedMutationOptions<TPayload, TResult> {
  // The API call. Receives the original payload + the reason string.
  mutationFn: (payload: TPayload & { reason: string }) => Promise<TResult>
  audit: AuditContext
  // Capability required to perform this action (checked client-side for UX;
  // the server enforces independently)
  capability: Capability
  onSuccess?: (result: TResult) => void
  onError?: (error: unknown) => void
}

export interface AuditedMutationState {
  isPending: boolean
  // Call this to begin the flow (opens ConfirmWithReason)
  trigger: () => void
}

export interface PendingMutation<TPayload> {
  payload: TPayload
  audit: AuditContext
  onConfirm: (reason: string) => Promise<void>
  onCancel: () => void
  requiresStepUp: boolean
}

// Global pending-mutation state shared with the ConfirmWithReason modal
// rendered in AppShell. Module code never manages the modal directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _setPending: ((m: PendingMutation<any> | null) => void) | null = null

export function _registerConfirmHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setter: (m: PendingMutation<any> | null) => void,
) {
  _setPending = setter
}

export function useAuditedMutation<TPayload extends object, TResult>(
  options: AuditedMutationOptions<TPayload, TResult>,
) {
  const { mutationFn, audit, capability, onSuccess, onError } = options
  const [isPending, setIsPending] = useState(false)

  const trigger = useCallback(
    (payload: TPayload) => {
      if (!_setPending) {
        console.error('[audit] ConfirmWithReason handler not registered. Is AppShell mounted?')
        return
      }

      const requiresStepUp = needsStepUp(capability)

      _setPending({
        payload,
        audit,
        requiresStepUp,
        onCancel: () => _setPending?.(null),
        onConfirm: async (reason: string) => {
          _setPending?.(null)
          setIsPending(true)
          try {
            const result = await mutationFn({ ...payload, reason })
            toast.success('Action completed successfully.')
            onSuccess?.(result)
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'An error occurred.'
            toast.error(msg)
            onError?.(err)
          } finally {
            setIsPending(false)
          }
        },
      })
    },
    [mutationFn, audit, capability, onSuccess, onError],
  )

  return { isPending, trigger }
}
