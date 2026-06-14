import type { Metadata } from 'next'
import { Star } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Reviews' }

export default function ReviewsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Reviews</h1>
      <EmptyState
        title="Review moderation"
        description="Held and flagged reviews (velocity spikes, graph-analysis clusters, low-trust reviewers). Approve or remove via the audited mutation flow."
        icon={Star}
      />
    </div>
  )
}
