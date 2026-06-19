// ─── Admin Reviews moderation module data layer ──────────────────────────────
//
// Moderates the reviews that feed the provider rating (§7.1). Links OUT to Users
// (reviewer + provider records) and Fraud (coordinated manipulation). Every
// action runs through useAuditedMutation — the wrapper appends { reason } and the
// API writes the audit entry + state change in one transaction.
//
// CONSUMES (never invents — impl_v3 §7.1 / §10.4 / §12):
//   - Only COMPLETED-booking reviews exist (§12) → the verified-booking marker.
//   - §7.1 Bayesian rating is shown read-only; REMOVING a review recomputes it
//     server-side (the existing nightly formula), never edited.
//   - Flag queue = persisted review_flags (reports / upstream) + computed
//     auto-flags (profanity / PII / links) + a pattern-flag (review-spike, §10.4,
//     also a Fraud signal → link out).
//
// PRIVACY: the reviewer is shown as normally displayed (first name + initial);
// internal 0–1 scores (trust_score / risk_score) are never exposed here.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'
import type { Paginated } from '@/lib/api/types'
import type { StatusVariant } from '@/components/ui/StatusPill'

// ── Status ───────────────────────────────────────────────────────────────────

export type ReviewStatus = 'VISIBLE' | 'REMOVED'

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  VISIBLE: 'Visible',
  REMOVED: 'Removed',
}

export const STATUS_VARIANT: Record<ReviewStatus, StatusVariant> = {
  VISIBLE: 'active',
  REMOVED: 'danger',
}

// ── Flag reasons ─────────────────────────────────────────────────────────────

export type FlagSource = 'report' | 'auto' | 'pattern' | 'flag'

export const FLAG_LABEL: Record<string, string> = {
  REPORTED: 'Reported by users',
  PROFANITY: 'Profanity',
  PII: 'Personal info in text',
  SPAM_LINK: 'Spam / link',
  RATING_BOMBING: 'Rating bombing',
  REVIEW_SPIKE: 'Review spike',
  OTHER: 'Flagged',
}

export function flagLabel(reason: string): string {
  return FLAG_LABEL[reason] ?? reason.replace(/_/g, ' ').toLowerCase()
}

// Reasons that indicate coordinated manipulation → escalate to Fraud.
export const FRAUD_REASONS = new Set(['REVIEW_SPIKE', 'RATING_BOMBING'])

export interface ReviewFlag {
  reason: string
  source: FlagSource
  detail: string | null
}

// ── Domain shapes ────────────────────────────────────────────────────────────

export interface ReviewRow {
  id: string
  rating: number
  snippet: string
  service_title: string | null
  verified_booking: boolean
  reviewer: { id: string; name: string }
  provider: { id: string; name: string }
  status: ReviewStatus
  flags: ReviewFlag[]
  created_at: string
}

export interface ProviderRating {
  r_raw: number | null
  reviews_count: number
  r_bayes: number | null
}

export interface ReviewDetail {
  id: string
  rating: number
  comment: string | null
  status: ReviewStatus
  created_at: string
  removed_at: string | null
  moderation_reason: string | null
  verified_booking: boolean
  booking: { id: string; status: string } | null
  service: { id: string; title: string } | null
  reviewer: { id: string | null; name: string }
  provider: {
    id: string | null
    name: string
    avatar_url: string | null
    trust_tier: number
    account_state: string
  }
  response: { text: string | null; responded_at: string | null } | null
  provider_rating: ProviderRating
  flags: ReviewFlag[]
}

// ── Query params ─────────────────────────────────────────────────────────────

export interface ReviewQueryParams {
  tab: 'needs_review' | 'all'
  page?: number
  search?: string
  rating?: string
  provider?: string
  flag_type?: string
  date_from?: string
  date_to?: string
}

export const FLAG_TYPE_OPTIONS = [
  { value: 'reported', label: 'Reported' },
  { value: 'profanity', label: 'Profanity' },
  { value: 'pii', label: 'Personal info' },
  { value: 'spam_link', label: 'Spam / link' },
  { value: 'review_spike', label: 'Review spike' },
  { value: 'removed', label: 'Removed' },
]

// ── API ──────────────────────────────────────────────────────────────────────

export const reviewsApi = {
  list: (params: ReviewQueryParams) => {
    const q = new URLSearchParams()
    q.set('tab', params.tab)
    q.set('page', String(params.page ?? 1))
    if (params.search) q.set('search', params.search)
    if (params.rating) q.set('rating', params.rating)
    if (params.provider) q.set('provider', params.provider)
    if (params.flag_type) q.set('flag_type', params.flag_type)
    if (params.date_from) q.set('date_from', params.date_from)
    if (params.date_to) q.set('date_to', params.date_to)
    return api.get<Paginated<ReviewRow>>(`/api/admin/reviews?${q}`)
  },

  detail: (id: string) => api.get<ReviewDetail>(`/api/admin/reviews/${id}`),

  // ── Moderation (all via useAuditedMutation — reason appended by the wrapper) ──
  // Remove triggers the §7.1 rating recompute for the provider.
  remove: (id: string, payload: { reason: string }) =>
    api.post<ReviewDetail>(`/api/admin/reviews/${id}/remove`, payload),

  restore: (id: string, payload: { reason: string }) =>
    api.post<ReviewDetail>(`/api/admin/reviews/${id}/restore`, payload),

  removeResponse: (id: string, payload: { reason: string }) =>
    api.post<ReviewDetail>(`/api/admin/reviews/${id}/remove-response`, payload),

  markNotViolation: (id: string, payload: { reason: string }) =>
    api.post<ReviewDetail>(`/api/admin/reviews/${id}/clear-flags`, payload),
}
