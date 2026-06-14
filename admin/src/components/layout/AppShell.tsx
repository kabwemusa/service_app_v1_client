'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { ConfirmWithReasonModal } from '@/components/ui/ConfirmWithReason'
import { ToastContainer } from '@/components/ui/Toast'
import { useAuthStore } from '@/lib/store/auth-store'
import { useIdleTimeout } from '@/lib/auth/idle-timeout'
import type { AdminTokenPayload } from '@/lib/api/types'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AppShellProps {
  // Server-decoded session passed from the layout Server Component
  initialSession: AdminTokenPayload
  children: ReactNode
}

export function AppShell({ initialSession, children }: AppShellProps) {
  const setUser = useAuthStore((s) => s.setUser)
  const router = useRouter()
  const [idleWarning, setIdleWarning] = useState(false)

  // Hydrate Zustand from the server-decoded session on mount
  useEffect(() => {
    setUser({
      id: initialSession.sub,
      email: initialSession.email,
      name: initialSession.name,
      role: initialSession.role,
      capabilities: initialSession.capabilities,
      avatarUrl: initialSession.avatar_url,
    })
  }, [initialSession, setUser])

  useIdleTimeout({
    onWarn: () => setIdleWarning(true),
    onTimeout: () => {
      setIdleWarning(false)
      router.push('/login?reason=idle')
    },
  })

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />

        {/* Idle warning banner */}
        {idleWarning && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Your session will expire in 5 minutes. Move the mouse or press a key to stay signed in.</span>
            <button
              onClick={() => setIdleWarning(false)}
              className="ml-auto text-xs underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Main content outlet */}
        <main
          id="main-content"
          className={cn(
            'flex-1 overflow-y-auto p-6',
          )}
        >
          {children}
        </main>
      </div>

      {/* Global modal + toast — rendered once here, all modules use them */}
      <ConfirmWithReasonModal />
      <ToastContainer />
    </div>
  )
}
