import type { Metadata } from 'next'
import { Briefcase } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Services' }

export default function ServicesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Services</h1>
      <EmptyState
        title="Service listings"
        description="Browse and moderate provider service listings. Hide, flag, or remove listings through the audited mutation flow."
        icon={Briefcase}
      />
    </div>
  )
}
