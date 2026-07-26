// ─── Admin Categories API module ───────────────────────────────────────────
//
// Consumes the admin category endpoints. All mutations go through the
// audited-mutation wrapper so a reason is always logged (v3 §8.1 / audit trail).
//
// Commission band is a string key referencing a §8.1 rate group.
// commission_rates is the per-tier JSONB map stored alongside the band label.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'

// ── §8.1 commission band definitions ──────────────────────────────────────
export const COMMISSION_BANDS = [
  { value: 'standard',     label: 'Standard',     defaultRates: { 1: 0.18, 2: 0.15, 3: 0.13, 4: 0.11 } },
  { value: 'micro',        label: 'Micro',         defaultRates: { 1: 0.15, 2: 0.13, 3: 0.12, 4: 0.10 } },
  { value: 'skilled',      label: 'Skilled',       defaultRates: { 1: 0.20, 2: 0.17, 3: 0.14, 4: 0.12 } },
  { value: 'professional', label: 'Professional',  defaultRates: { 1: 0.22, 2: 0.18, 3: 0.15, 4: 0.13 } },
  { value: 'high_risk',    label: 'High Risk',     defaultRates: { 1: 0.25, 2: 0.22, 3: 0.18, 4: 0.15 } },
] as const

export type CommissionBandValue = (typeof COMMISSION_BANDS)[number]['value']

// ── Pricing models (labels mirror config/pricing.php — the provider/customer
// surfaces read them from GET /pricing-models; this static list is only the
// admin control for choosing a category's guidance). ──────────────────────────
export const PRICING_MODELS = [
  { value: 'OUTCOME_FIXED',  label: 'Fixed price' },
  { value: 'PROVIDER_SCOPE', label: 'Price after you see the job' },
  { value: 'HOURLY_CAPPED',  label: 'Time-based (open-ended)' },
  { value: 'QUOTE_DEPOSIT',  label: 'Quote with deposit' },
] as const

export type PricingModelValue = (typeof PRICING_MODELS)[number]['value']

export function pricingModelLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return PRICING_MODELS.find((m) => m.value === value)?.label ?? value
}

export function bandLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return COMMISSION_BANDS.find((b) => b.value === value)?.label ?? value
}

export function defaultRatesForBand(value: string): Record<string, number> | undefined {
  const band = COMMISSION_BANDS.find((b) => b.value === value)
  if (!band) return undefined
  return Object.fromEntries(
    Object.entries(band.defaultRates).map(([k, v]) => [k, v]),
  )
}

// ── Domain types ───────────────────────────────────────────────────────────

export interface AdminCategory {
  id: number
  parent_id: number | null
  name: string
  slug: string
  synonyms: string[]
  icon: string | null
  icon_url: string | null
  is_active: boolean
  display_order: number
  commission_band: string | null
  commission_rates: Record<string, number> | null
  // Category-driven pricing-model guidance (admin-editable).
  default_pricing_model: string | null
  recommended_pricing_models: string[] | null
  pricing_rationale: string | null
  pricing_mismatch_warning: string | null
  children: AdminCategory[]
}

export interface CategoryPayload {
  name?: string
  slug?: string
  parent_id?: number | null
  icon?: string | null
  synonyms?: string[]
  display_order?: number
  is_active?: boolean
  commission_band?: string | null
  commission_rates?: Record<string, number>
  default_pricing_model?: string | null
  recommended_pricing_models?: string[] | null
  pricing_rationale?: string | null
  pricing_mismatch_warning?: string | null
  reason: string
}

export interface ReorderItem {
  id: number
  display_order: number
}

// ── API response shape ─────────────────────────────────────────────────────

interface ApiSuccess<T> {
  data: T
  message: string
}

// ── API calls ──────────────────────────────────────────────────────────────

export const categoriesApi = {
  list: () =>
    api.get<ApiSuccess<AdminCategory[]>>('/api/admin/categories'),

  create: (payload: CategoryPayload) =>
    api.post<ApiSuccess<AdminCategory>>('/api/admin/categories', payload),

  update: (id: number, payload: CategoryPayload) =>
    api.put<ApiSuccess<AdminCategory>>(`/api/admin/categories/${id}`, payload),

  delete: (id: number, payload: { reason: string }) =>
    api.delete<ApiSuccess<null>>(`/api/admin/categories/${id}`, { body: payload }),

  reorder: (items: ReorderItem[], reason: string) =>
    api.patch<ApiSuccess<null>>('/api/admin/categories/reorder', { items, reason }),
}

// ── Derived helpers ────────────────────────────────────────────────────────

/** Flatten an admin category tree into an ordered list for table rendering. */
export function flattenCategories(
  categories: AdminCategory[],
  expandedIds: Set<number>,
): Array<AdminCategory & { depth: number; childCount: number }> {
  const rows: Array<AdminCategory & { depth: number; childCount: number }> = []
  for (const cat of categories) {
    rows.push({ ...cat, depth: 0, childCount: cat.children.length })
    if (expandedIds.has(cat.id) && cat.children.length > 0) {
      for (const child of cat.children) {
        rows.push({ ...child, depth: 1, childCount: child.children.length })
      }
    }
  }
  return rows
}

/** Representative display rate for a category (tier-3 rate as a percentage string). */
export function displayRate(cat: AdminCategory): string | null {
  const rate = cat.commission_rates?.['3'] ?? cat.commission_rates?.[3 as unknown as string]
  if (rate == null) return null
  return `${Math.round(Number(rate) * 100)}%`
}
