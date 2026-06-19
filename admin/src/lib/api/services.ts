// ─── Admin Services moderation module data layer ─────────────────────────────
//
// Reviews provider service listings for quality + policy (v3.1 §5 entity).
// Other modules deep-link IN; this module links OUT to Users (provider record)
// and Categories. Every moderation action runs through useAuditedMutation — the
// wrapper appends { reason } and the API writes the audit entry + state change in
// one transaction.
//
// CONSUMES (never invents — impl_v3 §5.3 / §8.1 / §10.3):
//   - §5 status lifecycle: DRAFT / ACTIVE / PAUSED / HIDDEN.
//   - §5.3 image-pipeline RESULTS on each photo (read-only: NSFW score, duplicate
//     match, EXIF flag) — the moderator decides, the system advises.
//   - listing_review_flags + computed policy/catalogue checks → the flag queue.
//   - §8.1 commission band — a service's category must reference a valid band.
//   - §10.3 contact-in-listing — phone / handle in PUBLIC title/description. In
//     DIRECT mode the concern is publishing direct contact to bypass the recorded
//     booking flow, NOT the act of paying directly.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'
import type { Paginated } from '@/lib/api/types'
import type { StatusVariant } from '@/components/ui/StatusPill'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

/** Service photos are stored as relative paths (service_photos/xxx.jpg). */
export function photoUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${API_BASE}/storage/${path.replace(/^\/+/, '')}`
}

// ── §5 status lifecycle ──────────────────────────────────────────────────────

export type ServiceStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'HIDDEN'

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  HIDDEN: 'Hidden',
}

export const STATUS_VARIANT: Record<ServiceStatus, StatusVariant> = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  HIDDEN: 'danger',
}

export type PricingModel = 'FIXED' | 'HOURLY' | 'QUOTE'

export const PRICING_LABEL: Record<PricingModel, string> = {
  FIXED: 'Fixed',
  HOURLY: 'Hourly',
  QUOTE: 'By quote',
}

// ── Flag reasons (catalogue of everything that can land a listing in review) ──

export type FlagSource = 'pipeline' | 'flag' | 'policy' | 'catalogue'

// Reason codes are written by upstream systems (listing_review_flags) OR derived
// server-side (CONTACT_IN_LISTING, BANDLESS_CATEGORY) OR from the §5.3 pipeline.
export const FLAG_LABEL: Record<string, string> = {
  // §5.3 image pipeline
  IMAGE_PIPELINE: 'Image flagged',
  NSFW_IMAGE: 'NSFW image',
  DUPLICATE_IMAGE: 'Duplicate image',
  EXIF_SUSPICIOUS: 'EXIF not stripped',
  // reports / upstream flags
  USER_REPORT: 'Reported by users',
  PROHIBITED_CONTENT: 'Prohibited content',
  LOWBALL_PRICE: 'Suspicious low price',
  // computed policy / catalogue
  CONTACT_IN_LISTING: 'Contact in listing',
  BANDLESS_CATEGORY: 'No commission band',
}

export function flagLabel(reason: string): string {
  return FLAG_LABEL[reason] ?? reason.replace(/_/g, ' ').toLowerCase()
}

export interface ServiceFlag {
  reason: string
  source: FlagSource
  detail: string | null
}

// ── Domain shapes ────────────────────────────────────────────────────────────

export interface ServiceRow {
  id: string
  title: string
  status: ServiceStatus
  pricing_model: PricingModel
  base_price: number | null
  category: { id: number; name: string | null; commission_band: string | null } | null
  provider: { id: string; name: string }
  flags: ServiceFlag[]
  created_at: string
}

export interface ServicePhotoResult {
  id: number
  path: string
  pipeline_status: 'PENDING' | 'CLEAN' | 'FLAGGED'
  nsfw_score: number | null
  duplicate_of: string | null
  exif_stripped: boolean
  issues: Array<'NSFW' | 'DUPLICATE' | 'EXIF'>
}

export interface ServiceDetail {
  id: string
  title: string
  description: string | null
  status: ServiceStatus
  pricing_model: PricingModel
  base_price: number | null
  duration_estimate_mins: number | null
  created_at: string
  moderation_reason: string | null
  inclusions: string[]
  addons: Array<{ id: number; name: string; price: number }>
  photos: ServicePhotoResult[]
  provider: {
    id: string
    name: string
    avatar_url: string | null
    trust_tier: number
    account_state: string
    rating: number | null
    reviews_count: number
    open_reports: number
  }
  category: {
    id: number
    name: string
    commission_band: string | null
    band_valid: boolean
  } | null
  flags: ServiceFlag[]
  in_flight_bookings: number
}

// ── Query params ─────────────────────────────────────────────────────────────

export interface ServiceQueryParams {
  tab: 'needs_review' | 'all'
  page?: number
  search?: string
  status?: ServiceStatus | ''
  category_id?: string
  provider?: string
  price_min?: string
  price_max?: string
}

// ── API ──────────────────────────────────────────────────────────────────────

export const servicesApi = {
  list: (params: ServiceQueryParams) => {
    const q = new URLSearchParams()
    q.set('tab', params.tab)
    q.set('page', String(params.page ?? 1))
    if (params.search) q.set('search', params.search)
    if (params.status) q.set('status', params.status)
    if (params.category_id) q.set('category_id', params.category_id)
    if (params.provider) q.set('provider', params.provider)
    if (params.price_min) q.set('price_min', params.price_min)
    if (params.price_max) q.set('price_max', params.price_max)
    return api.get<Paginated<ServiceRow>>(`/api/admin/services?${q}`)
  },

  detail: (id: string) => api.get<ServiceDetail>(`/api/admin/services/${id}`),

  // ── Moderation (all via useAuditedMutation — reason appended by the wrapper) ──
  hide: (id: string, payload: { reason: string }) =>
    api.post<ServiceDetail>(`/api/admin/services/${id}/hide`, payload),

  requireChanges: (id: string, payload: { reason: string }) =>
    api.post<ServiceDetail>(`/api/admin/services/${id}/require-changes`, payload),

  restore: (id: string, payload: { reason: string }) =>
    api.post<ServiceDetail>(`/api/admin/services/${id}/restore`, payload),

  reassignCategory: (id: string, payload: { category_id: number; reason: string }) =>
    api.post<ServiceDetail>(`/api/admin/services/${id}/reassign-category`, payload),

  removePhoto: (id: string, photoId: number, payload: { reason: string }) =>
    api.delete<ServiceDetail>(`/api/admin/services/${id}/photos/${photoId}`, { body: payload }),
}
