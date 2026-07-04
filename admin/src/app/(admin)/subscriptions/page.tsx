import type { Metadata } from 'next'
import { IoCardOutline } from 'react-icons/io5'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Subscriptions' }

export default function SubscriptionsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Subscriptions</h1>
      <EmptyState
        title="Provider subscriptions"
        description="FREE / PRO / ELITE plan status, renewal dates, grace-period tracking, and manual plan adjustments."
        icon={IoCardOutline}
      />
    </div>
  )
}
