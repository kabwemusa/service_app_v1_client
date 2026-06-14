import Link from 'next/link'
import { ShieldOff } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: '403 Forbidden' }

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center p-8">
      <ShieldOff className="size-12 text-slate-300" strokeWidth={1.5} />
      <div className="space-y-1">
        <h1 className="text-lg font-medium text-slate-800 dark:text-slate-200">
          Access denied
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs">
          Your role does not have permission to view this page.
          Contact a super admin if you believe this is a mistake.
        </p>
      </div>
      <Link
        href="/dashboard"
        className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
