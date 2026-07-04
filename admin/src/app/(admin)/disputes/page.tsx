import type { Metadata } from 'next'
import { IoScaleOutline } from 'react-icons/io5'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Disputes' }

export default function DisputesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Disputes</h1>
      <EmptyState
        title="Dispute queue"
        description="Open disputes with evidence, timelines, and graded resolution (RESOLVED_BUYER, RESOLVED_PROVIDER, RESOLVED_PARTIAL) will appear here."
        icon={IoScaleOutline}
      />
    </div>
  )
}
