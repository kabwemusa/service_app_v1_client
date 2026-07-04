// ─── Admin Platform Settings API module ────────────────────────────────────
//
// super_admin only. Every edit is audited with before/after. Note: most
// settings here are RECORDED and audited but not yet threaded into the live
// runtime services (RankingService/CommissionService/dispatch config still
// read config()/env() at boot) — the `live` flag on each setting reflects
// this honestly. Risk-tier requirements are the exception: that table is
// read live by KycService today.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'

export type SettingGroup = 'general' | 'dispatch' | 'verification' | 'alerts'
export type SettingType = 'int' | 'float' | 'weights' | 'routing' | `enum:${string}`

export interface SettingItem {
  key: string
  type: SettingType
  label: string
  value: unknown
  live: boolean
  updated_at: string | null
}

export interface TrustWeights {
  identity: number
  reliability: number
  financial: number
  ratings: number
}

export interface AlertRouting {
  roles: string[]
  channels: string[]
}

// `risk_tier` here is the SERVICE risk category (1=remote, 2=public-venue,
// 3=in-home). `requirements` is keyed by the PROVIDER's trust tier
// (tier_1..tier_4) — a different axis — matching RiskTierConfig::
// requirementsForTrustTier() on the backend, which live-enforces this shape.
export interface RiskTier {
  risk_tier: number
  label: string
  requirements: Record<string, string[]>
  description: string | null
}

export interface DenylistCheckConfig {
  wired: Array<{ signal: string; checked_at: string }>
  not_wired: Array<{ signal: string; reason: string }>
}

export const settingsApi = {
  group: (group: SettingGroup) => api.get<{ data: SettingItem[] }>(`/api/admin/settings/groups/${group}`),

  update: (key: string, payload: { value: unknown; reason: string }) =>
    api.patch<{ data: SettingItem[] }>(`/api/admin/settings/${key}`, payload),

  riskTiers: () => api.get<{ data: RiskTier[] }>('/api/admin/settings/risk-tiers'),

  updateRiskTier: (riskTier: number, payload: { requirements: Record<string, string[]>; reason: string }) =>
    api.patch<{ data: RiskTier[] }>(`/api/admin/settings/risk-tiers/${riskTier}`, payload),

  denylistConfig: () => api.get<DenylistCheckConfig>('/api/admin/settings/denylist-config'),
}
