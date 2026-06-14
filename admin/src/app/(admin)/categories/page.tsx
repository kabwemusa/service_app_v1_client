import type { Metadata } from 'next'
import { Tag } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Categories' }

export default function CategoriesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Categories</h1>
      <EmptyState
        title="Category management"
        description="CRUD for service categories with per-tier commission rate editing (JSONB map). Changes are audit-logged."
        icon={Tag}
      />
    </div>
  )
}
