'use client'

import { useTheme } from 'next-themes'
import { Bell, Search, Sun, Moon, LogOut } from 'lucide-react'
import { useAuthStore } from '@/lib/store/auth-store'
import { Avatar } from '@/components/ui/Avatar'
import { RoleBadge } from '@/components/ui/RoleBadge'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api/client'
import { toast } from '@/lib/store/toast-store'

export function TopBar() {
  const user = useAuthStore((s) => s.user)
  const clearUser = useAuthStore((s) => s.clearUser)
  const { theme, setTheme } = useTheme()
  const router = useRouter()

  async function handleLogout() {
    try {
      await api.post('/api/admin/auth/logout')
    } catch {
      /* ignore logout errors */
    }
    clearUser()
    router.push('/login')
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-700 dark:bg-slate-900">
      {/* Global search */}
      <div className="relative w-64">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Search…"
          className={cn(
            'h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm',
            'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500',
            'dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100',
          )}
          aria-label="Global search"
        />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <button
          className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          {/* Badge placeholder — modules add real count */}
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-500" />
        </button>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>

        {/* Current admin */}
        {user && (
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-700">
            <Avatar name={user.name} src={user.avatarUrl} size="sm" />
            <div className="hidden sm:block">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 leading-tight">
                {user.name}
              </p>
              <RoleBadge role={user.role} />
            </div>

            <button
              onClick={handleLogout}
              className="ml-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-800"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
