'use client'

import { useState } from 'react'
import { IoBarChartOutline } from 'react-icons/io5'
import { TabBar } from '@/components/ui/TabBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { useCan } from '@/lib/rbac/use-can'
import { DispatchTab } from '@/components/insights/DispatchTab'
import { TrustTab } from '@/components/insights/TrustTab'
import { SupplyTab } from '@/components/insights/SupplyTab'
import { RankingTab } from '@/components/insights/RankingTab'

type Tab = 'dispatch' | 'trust' | 'supply' | 'ranking'

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'dispatch', label: 'Dispatch' },
  { value: 'trust', label: 'Trust' },
  { value: 'supply', label: 'Supply' },
  { value: 'ranking', label: 'Ranking' },
]

export function InsightsManager() {
  const [tab, setTab] = useState<Tab>('dispatch')
  const canView = useCan('read:insights')

  if (!canView) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Insights</h1>
        <EmptyState title="Access denied" description="You do not have permission to view dispatch and trust insights." icon={IoBarChartOutline} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-medium text-slate-900 dark:text-slate-100">
          <IoBarChartOutline className="size-5 text-teal-600" />
          Dispatch &amp; Trust Insights
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Health of the trust engine and dispatch pipeline — spot problems before they hit providers or customers.
        </p>
      </div>

      <TabBar items={TABS} active={tab} onChange={setTab} ariaLabel="Insights views" />

      {tab === 'dispatch' && <DispatchTab />}
      {tab === 'trust' && <TrustTab />}
      {tab === 'supply' && <SupplyTab />}
      {tab === 'ranking' && <RankingTab />}
    </div>
  )
}
