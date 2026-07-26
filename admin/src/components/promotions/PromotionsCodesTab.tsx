'use client'

import { PromotionsCampaignsTab } from '@/components/promotions/PromotionsCampaignsTab'

/**
 * Promo codes are campaigns with a code a customer enters at checkout. They
 * share the campaign model (offer / limits / budget) and validate server-side —
 * so this tab is the campaigns list scoped to code-based campaigns.
 */
export function PromotionsCodesTab() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Code-based campaigns. Customers enter the code at checkout; it is validated server-side against
        the offer, limits, and budget.
      </p>
      <PromotionsCampaignsTab kind="code" />
    </div>
  )
}
