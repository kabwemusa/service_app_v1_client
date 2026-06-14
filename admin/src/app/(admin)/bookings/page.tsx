import type { Metadata } from 'next'
import { Calendar } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Bookings' }

export default function BookingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Bookings</h1>
      <EmptyState
        title="Booking management"
        description="Bookings with escrow state, payment status, and dispute history. Manual overrides use the audited mutation flow."
        icon={Calendar}
      />
    </div>
  )
}
