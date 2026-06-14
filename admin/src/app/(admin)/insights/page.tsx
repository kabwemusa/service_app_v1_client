import type { Metadata } from 'next'
import { BarChart3 } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Insights' }

export default function InsightsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Insights</h1>
      <EmptyState
        title="Platform analytics"
        description="GMV trends, trust funnel (Tier 0→4 conversion), booking completion rate, dispute rate, take rate, and reliability metrics. Read-only for analyst role."
        icon={BarChart3}
      />
    </div>
  )
}
