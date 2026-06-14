import type { Metadata } from 'next'
import { Shield } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Safety' }

export default function SafetyPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Safety</h1>
      <EmptyState
        title="Safety reports"
        description="Safety reports (harassment, violence, unsafe behaviour) requiring same-hour review will appear here."
        icon={Shield}
      />
    </div>
  )
}
