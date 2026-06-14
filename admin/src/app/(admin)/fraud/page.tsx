import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Fraud & denylist' }

export default function FraudPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Fraud & denylist</h1>
      <EmptyState
        title="Fraud operations panel"
        description="Circumvention flags, collusion community alerts, denylist administration, and account suspension actions will appear here."
        icon={AlertTriangle}
      />
    </div>
  )
}
