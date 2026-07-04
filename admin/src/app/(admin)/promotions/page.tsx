import type { Metadata } from 'next'
import { IoMegaphoneOutline } from 'react-icons/io5'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Promotions' }

export default function PromotionsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Promotions</h1>
      <EmptyState
        title="Promoted slot management"
        description="Active promoted slots, bid amounts, impressions, click-through, and bookings sourced per slot."
        icon={IoMegaphoneOutline}
      />
    </div>
  )
}
