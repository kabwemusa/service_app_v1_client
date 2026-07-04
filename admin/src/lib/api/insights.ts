// ─── Admin Dispatch & Trust Insights API module ────────────────────────────
//
// Read-only observability. "Auto vs shortlist split" and "avg accept time"
// are intentionally NOT modeled — no column records which dispatch path was
// used or when a provider accepted, so those two figures from the original
// spec are left out rather than approximated from nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'

export interface DispatchInsights {
  kpis: {
    bookings_dispatched: number
    avg_cascade_depth: number | null
    no_provider_rate: number | null
  }
  cascade_distribution: Array<{ depth: number; count: number }>
  no_provider_events: Array<{ id: string; time_of_day: string; created_at: string }>
}

export interface TrustInsights {
  score_distribution: Array<{ bucket: string; count: number }>
  tier_breakdown: Array<{ tier: number; count: number }>
  shrinkage: { total_providers: number; shrinkage_dominated: number; min_reviews_threshold: number }
  low_score_providers: Array<{ provider_id: string; name: string; score: number }>
  recompute_events: Array<{ provider_id: string; reason: string; old_score: number | null; new_score: number; created_at: string }>
}

export interface SupplyInsights {
  fairness: {
    probation_share_of_recent_bookings: number | null
    probation_activation_rate: number | null
    graduation_rate: number | null
    probation_jobs_threshold: number
  }
  coverage_gaps: Array<{ category_id: number; category_name: string; eligible_providers: number }>
  availability_heatmap: Array<{ day_of_week: number; hour: number; count: number }>
}

export interface RankingCategory {
  id: number
  name: string
}

// Every field is a named term from the live v3.2 §1.3 scoring formula
// (RankingService::scoreBreakdown) — S = 0.25r + 0.15c + 0.15ver + 0.10resp
// + 0.05f + 0.20d + 0.10p, then (S_organic + b_cold + b_personal) × m_tier.
export interface ScoreBreakdown {
  r: number
  c: number
  ver: number
  resp: number
  f: number
  d: number
  p: number
  s_organic: number
  b_cold: number
  b_personal: number
  m_tier: number
  score: number
}

export interface RankedProvider {
  service_id: string
  provider_id: string
  provider_name: string
  service_title: string
  trust_tier: number
  r_bayes: number
  completed_jobs: number
  breakdown: ScoreBreakdown
  rank: number
}

export interface RankingResult {
  category_id: number
  note: string
  providers: RankedProvider[]
}

export const insightsApi = {
  dispatch: () => api.get<DispatchInsights>('/api/admin/insights/dispatch'),
  trust: () => api.get<TrustInsights>('/api/admin/insights/trust'),
  supply: () => api.get<SupplyInsights>('/api/admin/insights/supply'),
  rankingCategories: () => api.get<{ data: RankingCategory[] }>('/api/admin/insights/ranking-categories'),
  ranking: (categoryId: number) => api.get<RankingResult>(`/api/admin/insights/ranking?category_id=${categoryId}`),
}
