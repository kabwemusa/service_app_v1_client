import type { Metadata } from 'next'
import { Percent } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Commissions' }

export default function CommissionsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Commissions</h1>
      <EmptyState
        title="Commission ledger"
        description="Per-booking commission records with gross amount, effective rate, VAT, and net-to-provider breakdown. Commission matrix editing is audit-logged."
        icon={Percent}
      />
    </div>
  )
}
