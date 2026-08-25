'use client'

import { useState } from 'react'
import { IoCashOutline } from 'react-icons/io5'
import { TabBar } from '@/components/ui/TabBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { useCan } from '@/lib/rbac/use-can'
import { FinanceOverviewTab } from '@/components/finance/FinanceOverviewTab'
import { FinanceCommissionsTab } from '@/components/finance/FinanceCommissionsTab'
import { FinanceEscrowTab } from '@/components/finance/FinanceEscrowTab'
import { FinancePayoutsTab } from '@/components/finance/FinancePayoutsTab'

type Tab = 'overview' | 'commissions' | 'escrow' | 'payouts'

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'commissions', label: 'Commissions' },
  { value: 'escrow', label: 'Escrow' },
  { value: 'payouts', label: 'Payouts' },
]

export function FinanceManager() {
  const [tab, setTab] = useState<Tab>('overview')
  const canView = useCan('read:commissions')

  if (!canView) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Finance</h1>
        <EmptyState title="Access denied" description="You do not have permission to view finance data." icon={IoCashOutline} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-medium text-slate-900 dark:text-slate-100">
          <IoCashOutline className="size-5 text-teal-600" />
          Finance
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Live GMV, commission collection, escrow health, and gateway reconciliation.
        </p>
      </div>

      <TabBar items={TABS} active={tab} onChange={setTab} ariaLabel="Finance views" />

      {tab === 'overview' && <FinanceOverviewTab />}
      {tab === 'commissions' && <FinanceCommissionsTab />}
      {tab === 'escrow' && <FinanceEscrowTab />}
      {tab === 'payouts' && <FinancePayoutsTab />}
    </div>
  )
}
