import type { Metadata } from 'next'
import Link from 'next/link'
import { Settings, Users, ClipboardList, SlidersHorizontal } from 'lucide-react'

export const metadata: Metadata = { title: 'Settings' }

const SECTIONS = [
  {
    href: '/settings/admins',
    icon: Users,
    label: 'Admins & roles',
    description: 'Manage admin accounts, assign roles, and revoke access.',
  },
  {
    href: '/settings/audit',
    icon: ClipboardList,
    label: 'Audit log',
    description: 'Append-only log of every state-changing admin action.',
  },
  {
    href: '/settings/platform-params',
    icon: SlidersHorizontal,
    label: 'Platform params',
    description: 'Tune ranking weights, caps, TTLs, and commission defaults (v3 §16). Changes are versioned and audit-logged.',
  },
]

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Platform configuration — super_admin only.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-teal-300 hover:bg-teal-50 transition-colors dark:border-slate-700 dark:bg-slate-800 dark:hover:border-teal-600 dark:hover:bg-teal-900/20"
          >
            <s.icon className="mt-0.5 size-5 shrink-0 text-slate-400 group-hover:text-teal-600 dark:text-slate-500 dark:group-hover:text-teal-400" strokeWidth={1.75} />
            <div>
              <p className="text-sm font-medium text-slate-800 group-hover:text-teal-700 dark:text-slate-200 dark:group-hover:text-teal-300">
                {s.label}
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {s.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
