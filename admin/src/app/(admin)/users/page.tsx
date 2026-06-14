import type { Metadata } from 'next'
import { Users } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Users' }

export default function UsersPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Users</h1>
      <EmptyState
        title="User management"
        description="Search, filter, and view customer and provider accounts. Account state changes (restrict, suspend, ban) go through the audited mutation flow."
        icon={Users}
      />
    </div>
  )
}
