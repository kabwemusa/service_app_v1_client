// ─── Admin Bookings API module ─────────────────────────────────────────────
//
// Read-only view of escrow state, payment status, and dispute history.
// Manual state overrides aren't exposed here — they'd touch the live booking
// state machine (BookingService), out of scope without an explicit ask.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'
import type { Paginated } from '@/lib/api/types'

export interface BookingRow {
  id: string
  service_title: string
  buyer_name: string
  provider_name: string
  status: string
  payment_mode: 'DIRECT' | 'ESCROW'
  payment_status: string | null
  amount: number
  scheduled_start: string | null
  disputed: boolean
  created_at: string
}

export interface EscrowEvent {
  id: string
  external_ref: string
  type: 'collection' | 'payout' | 'refund'
  provider_status: string
  mno: string | null
  amount: number | null
  created_at: string
}

export interface BookingDetail {
  id: string
  status: string
  payment_mode: 'DIRECT' | 'ESCROW'
  payment_status: string | null
  amount: number
  quoted_amount: number | null
  buyer_protection_fee: number
  buyer: { id: string; name: string; phone_masked: string | null } | null
  provider: { id: string; name: string; momo_masked: string | null } | null
  service: { id: string; title: string; category_name: string | null } | null
  delivery_location_label: string | null
  delivery_location_region: string | null
  timeline: {
    created_at: string | null
    scheduled_start: string | null
    scheduled_end: string | null
    payment_marked_at: string | null
    provider_marked_paid_at: string | null
    customer_marked_paid_at: string | null
    payout_eligible_at: string | null
    completed_at: string | null
    disbursed_at: string | null
    expires_at: string | null
  }
  commission: {
    gross_amount: number
    commission_rate: number
    commission_amount: number
    net_to_provider: number
    collection_status: string
  } | null
  dispute: {
    id: string
    status: string
    reason_category: string
    refund_amount: number | null
    opened_at: string | null
    resolved_at: string | null
  } | null
  review: { rating: number; removed: boolean } | null
  escrow_events: EscrowEvent[]
}

export const bookingsApi = {
  list: (params: { page?: number; search?: string; status?: string; payment_mode?: string; disputed?: string; date_from?: string }) => {
    const q = new URLSearchParams()
    q.set('page', String(params.page ?? 1))
    if (params.search) q.set('search', params.search)
    if (params.status) q.set('status', params.status)
    if (params.payment_mode) q.set('payment_mode', params.payment_mode)
    if (params.disputed) q.set('disputed', params.disputed)
    if (params.date_from) q.set('date_from', params.date_from)
    return api.get<Paginated<BookingRow>>(`/api/admin/bookings?${q}`)
  },

  detail: (id: string) => api.get<BookingDetail>(`/api/admin/bookings/${id}`),
}
