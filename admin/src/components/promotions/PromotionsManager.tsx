'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IoMegaphoneOutline, IoTicketOutline, IoPeopleOutline, IoBarChartOutline } from 'react-icons/io5'
import { TabBar } from '@/components/ui/TabBar'
import { MetricCard } from '@/components/ui/MetricCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { useCan } from '@/lib/rbac/use-can'
import { useAdminChannel } from '@/lib/realtime/useAdminChannel'
import { useQueryClient } from '@tanstack/react-query'
import { fmtZMW } from '@/lib/utils'
import { promotionsApi } from '@/lib/api/promotions'
import { PromotionsCampaignsTab } from '@/components/promotions/PromotionsCampaignsTab'
import { PromotionsCodesTab } from '@/components/promotions/PromotionsCodesTab'
import { PromotionsReferralsTab } from '@/components/promotions/PromotionsReferralsTab'
import { PromotionsPerformanceTab } from '@/components/promotions/PromotionsPerformanceTab'

type Tab = 'campaigns' | 'codes' | 'referrals' | 'performance'

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'campaigns', label: 'Campaigns' },
  { value: 'codes', label: 'Promo codes' },
  { value: 'referrals', label: 'Referrals' },
  { value: 'performance', label: 'Performance' },
]

export function PromotionsManager() {
  const [tab, setTab] = useState<Tab>('campaigns')
  const canView = useCan('read:promotions')
  const queryClient = useQueryClient()

  const { data: overview } = useQuery({
    queryKey: ['promotions-overview'],
    queryFn: () => promotionsApi.overview(),
    enabled: canView,
  })

  // Real-time: a campaign launch / pause / redemption / budget exhaustion
  // refreshes the KPIs and every campaign list without a reload.
  useAdminChannel('promotions', {
    'campaign.updated': () => {
      queryClient.invalidateQueries({ queryKey: ['promotions-overview'] })
      queryClient.invalidateQueries({ queryKey: ['promotions-campaigns'] })
    },
  })

  if (!canView) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Growth &amp; Promotions</h1>
        <EmptyState title="Access denied" description="You do not have permission to view promotions." icon={IoMegaphoneOutline} />
      </div>
    )
  }

  const k = overview?.kpis

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-medium text-slate-900 dark:text-slate-100">
          <IoMegaphoneOutline className="size-5 text-teal-600" />
          Growth &amp; Promotions
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Run campaigns to customers and providers. Sebenza absorbs customer discounts — the provider is always paid in full.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Active campaigns" value={k?.active_campaigns ?? '—'} icon={IoMegaphoneOutline} />
        <MetricCard
          title={`Redemptions (${k?.window_days ?? 30}d)`}
          value={k?.redemptions_window ?? '—'}
          icon={IoTicketOutline}
        />
        <MetricCard
          title="Discount spend"
          value={k ? fmtZMW(k.discount_spend) : '—'}
          subtitle={`Last ${k?.window_days ?? 30} days`}
          icon={IoBarChartOutline}
        />
        <MetricCard title="Bookings driven" value={k?.bookings_driven ?? '—'} icon={IoPeopleOutline} />
      </div>

      <TabBar items={TABS} active={tab} onChange={setTab} ariaLabel="Promotions views" />

      {tab === 'campaigns' && <PromotionsCampaignsTab />}
      {tab === 'codes' && <PromotionsCodesTab />}
      {tab === 'referrals' && <PromotionsReferralsTab />}
      {tab === 'performance' && <PromotionsPerformanceTab />}
    </div>
  )
}
