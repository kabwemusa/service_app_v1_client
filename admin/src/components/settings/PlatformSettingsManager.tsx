'use client'

import { useState } from 'react'
import Link from 'next/link'
import { IoSettingsOutline, IoClipboardOutline, IoOpenOutline } from 'react-icons/io5'
import { TabBar } from '@/components/ui/TabBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { useCan } from '@/lib/rbac/use-can'
import { GeneralTab } from '@/components/settings/GeneralTab'
import { DispatchSettingsTab } from '@/components/settings/DispatchSettingsTab'
import { VerificationSettingsTab } from '@/components/settings/VerificationSettingsTab'
import { AlertsTab } from '@/components/settings/AlertsTab'

type Tab = 'general' | 'dispatch' | 'verification' | 'alerts'

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'dispatch', label: 'Dispatch' },
  { value: 'verification', label: 'Verification' },
  { value: 'alerts', label: 'Alerts' },
]

export function PlatformSettingsManager() {
  const [tab, setTab] = useState<Tab>('general')
  const canView = useCan('read:settings')

  if (!canView) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Settings</h1>
        <EmptyState title="Access denied" description="Platform settings are super_admin only." icon={IoSettingsOutline} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-medium text-slate-900 dark:text-slate-100">
            <IoSettingsOutline className="size-5 text-teal-600" />
            Settings
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            System-level configuration. Every change is audited with before/after.
          </p>
        </div>
        <Link href="/settings/audit" className="flex shrink-0 items-center gap-1 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">
          <IoClipboardOutline className="size-3.5" /> Audit log <IoOpenOutline className="size-3" />
        </Link>
      </div>

      <TabBar items={TABS} active={tab} onChange={setTab} ariaLabel="Settings views" />

      {tab === 'general' && <GeneralTab />}
      {tab === 'dispatch' && <DispatchSettingsTab />}
      {tab === 'verification' && <VerificationSettingsTab />}
      {tab === 'alerts' && <AlertsTab />}
    </div>
  )
}
