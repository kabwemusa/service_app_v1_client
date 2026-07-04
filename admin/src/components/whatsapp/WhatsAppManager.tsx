'use client'

import { useState } from 'react'
import { IoLogoWhatsapp } from 'react-icons/io5'
import { TabBar } from '@/components/ui/TabBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { useCan } from '@/lib/rbac/use-can'
import { WhatsAppOverviewTab } from '@/components/whatsapp/WhatsAppOverviewTab'
import { WhatsAppTemplatesTab } from '@/components/whatsapp/WhatsAppTemplatesTab'
import { WhatsAppConversationsTab } from '@/components/whatsapp/WhatsAppConversationsTab'
import { WhatsAppLogsTab } from '@/components/whatsapp/WhatsAppLogsTab'

type Tab = 'overview' | 'templates' | 'conversations' | 'logs'

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'templates', label: 'Templates' },
  { value: 'conversations', label: 'Conversations' },
  { value: 'logs', label: 'Logs' },
]

export function WhatsAppManager() {
  const [tab, setTab] = useState<Tab>('overview')
  const canView = useCan('platform.ops')

  if (!canView) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">WhatsApp Ops</h1>
        <EmptyState title="Access denied" description="You do not have permission to view WhatsApp operations data." icon={IoLogoWhatsapp} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-medium text-slate-900 dark:text-slate-100">
          <IoLogoWhatsapp className="size-5 text-teal-600" />
          WhatsApp Ops
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Bot health, template status, conversation volume, and stuck or failed conversations.
        </p>
      </div>

      <TabBar items={TABS} active={tab} onChange={setTab} ariaLabel="WhatsApp Ops views" />

      {tab === 'overview' && <WhatsAppOverviewTab />}
      {tab === 'templates' && <WhatsAppTemplatesTab />}
      {tab === 'conversations' && <WhatsAppConversationsTab />}
      {tab === 'logs' && <WhatsAppLogsTab />}
    </div>
  )
}
