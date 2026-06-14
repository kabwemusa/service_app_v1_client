import type { Metadata } from 'next'
import { Image as ImageIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Banners' }

export default function BannersPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Banners</h1>
      <EmptyState
        title="Banner management"
        description="App banners for announcements, promotions and onboarding nudges. Create, schedule and retire banners."
        icon={ImageIcon}
      />
    </div>
  )
}
