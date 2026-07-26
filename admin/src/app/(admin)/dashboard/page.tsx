import type { Metadata } from 'next'
import { DashboardMetrics } from '@/components/dashboard/DashboardMetrics'

export const metadata: Metadata = { title: 'Dashboard' }

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Marketplace health at a glance.
        </p>
      </div>

      <DashboardMetrics />
    </div>
  )
}
