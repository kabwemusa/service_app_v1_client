import type { Metadata } from 'next'
import { LayoutDashboard, Users, Calendar, Scale, AlertTriangle } from 'lucide-react'
import { MetricCard } from '@/components/ui/MetricCard'
import { EmptyState } from '@/components/ui/EmptyState'

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

      {/* Metric cards — module fills with live data */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard title="Active providers" value="—" icon={Users} />
        <MetricCard title="Bookings today" value="—" icon={Calendar} />
        <MetricCard title="Open disputes" value="—" icon={Scale} />
        <MetricCard title="Fraud flags (24h)" value="—" icon={AlertTriangle} />
      </div>

      {/* Queue previews — modules fill these in */}
      <EmptyState
        title="Dashboard widgets"
        description="Module implementations add KYC queue, dispute SLA, payout status and other live metric widgets here."
        icon={LayoutDashboard}
      />
    </div>
  )
}
