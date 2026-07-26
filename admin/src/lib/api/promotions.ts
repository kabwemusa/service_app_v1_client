// ─── Admin Growth & Promotions API module ──────────────────────────────────
//
// Campaign CRUD + launch/pause/end, promo codes, referral config, and live
// performance. Campaigns render in the app (home banner / search badge /
// checkout) and Sebenza absorbs customer discounts — the provider is paid in
// full. All mutations go through the audited-mutation wrapper.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'
import type { Paginated } from '@/lib/api/types'

export type AudienceType = 'CUSTOMER' | 'PROVIDER'
export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'PAUSED' | 'ENDED' | 'BUDGET_EXHAUSTED'
export type PlacementSlot =
  | 'APP_HOME_BANNER' | 'APP_SEARCH_BADGE' | 'APP_CHECKOUT'
  | 'PWA_HOME_BANNER' | 'PWA_SEARCH_BADGE' | 'PWA_CHECKOUT' | 'WHATSAPP_BROADCAST'

export interface CampaignMetrics {
  redemptions: number
  spend: number
  budget_cap: number | null
  bookings_driven: number
}

export interface CampaignRow {
  id: string
  name: string
  audience_type: AudienceType
  audience_filter: string
  offer_type: string
  offer_value: number
  placements: PlacementSlot[]
  code: string | null
  status: CampaignStatus
  start_at: string | null
  end_at: string | null
  metrics: CampaignMetrics
}

export interface CampaignDetail extends CampaignRow {
  audience_params: Record<string, unknown>
  offer_params: Record<string, unknown>
  content: Record<string, unknown>
  code_multi_use: boolean
  max_uses_per_user: number | null
  total_uses_cap: number | null
  total_uses: number
  created_at: string | null
}

export interface PromotionsOverview {
  kpis: {
    active_campaigns: number
    redemptions_window: number
    discount_spend: number
    bookings_driven: number
    window_days: number
  }
}

export interface CampaignPerformance {
  campaign: CampaignRow
  redemptions: number
  spend: number
  bookings_driven: number
  incremental_measured: boolean
  daily: Array<{ day: string; redemptions: number; spend: number }>
}

export interface ReferralConfig {
  enabled: boolean
  referrer_reward_zmw: number
  referee_reward_zmw: number
  max_referrals_per_user: number | null
  budget_cap: number | null
  budget_spent: number
  implemented: boolean
}

// The shape the composer submits (reason appended by the audited-mutation wrapper).
export interface CampaignInput {
  name: string
  audience_type: AudienceType
  audience_filter: string
  audience_params?: Record<string, unknown>
  offer_type: string
  offer_value?: number
  offer_params?: Record<string, unknown>
  placements: PlacementSlot[]
  content?: Record<string, unknown>
  code?: string | null
  code_multi_use?: boolean
  start_at?: string | null
  end_at?: string | null
  budget_cap?: number | null
  max_uses_per_user?: number | null
  total_uses_cap?: number | null
  launch?: boolean
}

export const promotionsApi = {
  overview: () => api.get<PromotionsOverview>('/api/admin/promotions/overview'),

  campaigns: (params: {
    page?: number
    status?: CampaignStatus | ''
    audience_type?: AudienceType | ''
    kind?: 'campaign' | 'code' | ''
    search?: string
  }) => {
    const q = new URLSearchParams()
    q.set('page', String(params.page ?? 1))
    if (params.status) q.set('status', params.status)
    if (params.audience_type) q.set('audience_type', params.audience_type)
    if (params.kind) q.set('kind', params.kind)
    if (params.search) q.set('search', params.search)
    return api.get<Paginated<CampaignRow>>(`/api/admin/promotions/campaigns?${q}`)
  },

  show: (id: string) => api.get<{ data: CampaignDetail }>(`/api/admin/promotions/campaigns/${id}`),

  performance: (id: string) =>
    api.get<{ data: CampaignPerformance }>(`/api/admin/promotions/campaigns/${id}/performance`),

  audienceEstimate: (payload: {
    audience_type: AudienceType
    audience_filter: string
    audience_params?: Record<string, unknown>
  }) => api.post<{ estimated_size: number }>('/api/admin/promotions/audience-estimate', payload),

  create: (payload: CampaignInput & { reason: string }) =>
    api.post<{ data: CampaignDetail }>('/api/admin/promotions/campaigns', payload),

  update: (id: string, payload: Partial<CampaignInput> & { reason: string }) =>
    api.patch<{ data: CampaignDetail }>(`/api/admin/promotions/campaigns/${id}`, payload),

  launch: (id: string, payload: { reason: string }) =>
    api.post<{ data: CampaignDetail }>(`/api/admin/promotions/campaigns/${id}/launch`, payload),

  pause: (id: string, payload: { reason: string }) =>
    api.post<{ data: CampaignDetail }>(`/api/admin/promotions/campaigns/${id}/pause`, payload),

  end: (id: string, payload: { reason: string }) =>
    api.post<{ data: CampaignDetail }>(`/api/admin/promotions/campaigns/${id}/end`, payload),

  referralConfig: () => api.get<{ data: ReferralConfig }>('/api/admin/promotions/referral-config'),

  updateReferralConfig: (payload: {
    enabled: boolean
    referrer_reward_zmw: number
    referee_reward_zmw: number
    max_referrals_per_user?: number | null
    budget_cap?: number | null
    reason: string
  }) => api.put<{ data: ReferralConfig }>('/api/admin/promotions/referral-config', payload),
}

// ── Display helpers (labels are UI-only; the server is the source of truth) ──

export const AUDIENCE_FILTER_LABELS: Record<string, string> = {
  NEW_CUSTOMERS: 'New customers',
  ALL_CUSTOMERS: 'All customers',
  LAPSED: 'Lapsed customers',
  BY_AREA: 'By area',
  BY_CATEGORY: 'By category',
  NEW_PROVIDERS: 'New providers',
  LOW_ACTIVITY: 'Low-activity providers',
}

export const OFFER_TYPE_LABELS: Record<string, string> = {
  PERCENT_OFF: 'Percent off',
  AMOUNT_OFF: 'Amount off',
  FREE_SERVICE_FEE: 'No service fee',
  ZERO_COMMISSION: 'Zero commission',
  REDUCED_COMMISSION: 'Reduced commission',
  BONUS: 'Bonus',
}

export const PLACEMENT_LABELS: Record<PlacementSlot, string> = {
  APP_HOME_BANNER: 'App · Home banner',
  APP_SEARCH_BADGE: 'App · Search badge',
  APP_CHECKOUT: 'App · Checkout',
  PWA_HOME_BANNER: 'PWA · Home banner',
  PWA_SEARCH_BADGE: 'PWA · Search badge',
  PWA_CHECKOUT: 'PWA · Checkout',
  WHATSAPP_BROADCAST: 'WhatsApp · Broadcast',
}
