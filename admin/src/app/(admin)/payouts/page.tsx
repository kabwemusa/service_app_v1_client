import type { Metadata } from 'next'
import { Wallet } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Payouts' }

export default function PayoutsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Payouts</h1>
      <EmptyState
        title="Payout operations"
        description="Daily settlement summary, failed payout retry queue with manual override, chargeback dashboard with response-deadline timers. All overrides are audit-logged."
        icon={Wallet}
      />
    </div>
  )
}
