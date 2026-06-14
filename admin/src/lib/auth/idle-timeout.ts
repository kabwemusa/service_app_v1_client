'use client'

import { useEffect, useRef, useCallback } from 'react'

const IDLE_TIMEOUT_MS = (Number(process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINS ?? 30)) * 60 * 1000
const WARN_BEFORE_MS = 5 * 60 * 1000 // show warning 5 min before expiry

interface IdleTimeoutOptions {
  onWarn?: () => void    // called when 5 min remain
  onTimeout?: () => void // called when the session expires
}

// Tracks user activity (mouse, keyboard, touch) and calls the callbacks when
// the admin has been idle for the configured duration. Attach in AppShell.
export function useIdleTimeout({ onWarn, onTimeout }: IdleTimeoutOptions) {
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expireTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    if (warnTimer.current) clearTimeout(warnTimer.current)
    if (expireTimer.current) clearTimeout(expireTimer.current)

    warnTimer.current = setTimeout(() => {
      onWarn?.()
    }, IDLE_TIMEOUT_MS - WARN_BEFORE_MS)

    expireTimer.current = setTimeout(() => {
      onTimeout?.()
    }, IDLE_TIMEOUT_MS)
  }, [onWarn, onTimeout])

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    const handler = () => reset()

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }))
    reset()

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler))
      if (warnTimer.current) clearTimeout(warnTimer.current)
      if (expireTimer.current) clearTimeout(expireTimer.current)
    }
  }, [reset])
}
