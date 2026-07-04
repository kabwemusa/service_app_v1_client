'use client'

import { useState } from 'react'
import { IoWarningOutline } from 'react-icons/io5'
import { TabBar } from '@/components/ui/TabBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { useCan } from '@/lib/rbac/use-can'
import { FraudPatternsTab } from '@/components/fraud/FraudPatternsTab'
import { FraudDenylistTab } from '@/components/fraud/FraudDenylistTab'
import { FraudEscalationsTab } from '@/components/fraud/FraudEscalationsTab'

type Tab = 'patterns' | 'denylist' | 'escalations'

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'patterns', label: 'Patterns' },
  { value: 'denylist', label: 'Denylist' },
  { value: 'escalations', label: 'Escalations' },
]

export function FraudManager() {
  const [tab, setTab] = useState<Tab>('patterns')
  const canView = useCan('read:fraud')

  if (!canView) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Fraud &amp; Denylist</h1>
        <EmptyState title="Access denied" description="You do not have permission to view fraud data." icon={IoWarningOutline} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-medium text-slate-900 dark:text-slate-100">
          <IoWarningOutline className="size-5 text-teal-600" />
          Fraud &amp; Denylist
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Pattern detection, the hashed denylist, and escalations from other modules.
        </p>
      </div>

      <TabBar items={TABS} active={tab} onChange={setTab} ariaLabel="Fraud views" />

      {tab === 'patterns' && <FraudPatternsTab />}
      {tab === 'denylist' && <FraudDenylistTab />}
      {tab === 'escalations' && <FraudEscalationsTab />}
    </div>
  )
}
