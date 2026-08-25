// ─── Admin Finance & Commissions API module ────────────────────────────────
//
// Live GMV/commission/escrow health + gateway reconciliation. Not a payout
// initiation tool — an ops and revenue-health view. Commission band edits and
// payout retries go through the audited-mutation wrapper.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'
import type { Paginated } from '@/lib/api/types'

export type Period = 'today' | 'week' | 'month' | 'custom'

export interface FinanceOverview {
  period: { from: string; to: string }
  kpis: {
    gmv: number
    commission_collected: number
    active_escrow_float: number
    refunds_issued: number
    refunds_total: number
    avg_commission_rate: number
  }
  trend: Array<{ date: string; gmv: number; commission: number }>
  top_categories: Array<{ id: number; name: string; gmv: number }>
}

export type CommissionStatus = 'collected' | 'uncollected' | 'disputed'

export interface CommissionRow {
  id: string
  booking_id: string
  provider_name: string
  buyer_name: string
  category_name: string | null
  gross_amount: number
  commission_rate: number
  commission_amount: number
  tier: number
  status: CommissionStatus
  payment_mode: 'DIRECT' | 'ESCROW'
  calculated_at: string
}

export interface CommissionBand {
  id: number
  name: string
  rates: Record<'1' | '2' | '3' | '4', number>
}

export type PaymentEventType = 'collection' | 'payout' | 'refund'
export type MatchStatus = 'MATCHED' | 'MISMATCH' | 'PENDING'

export interface EscrowRow {
  id: string
  booking_id: string | null
  external_ref: string
  type: PaymentEventType
  amount: number | null
  mno: string | null
  /** Which processor wrote the event — 'lipila' now, 'lenco'/'pawapay' for historical rows. */
  provider: string | null
  provider_status: string
  booking_status: string | null
  match: MatchStatus
  created_at: string
}

export type PayoutStatus = 'success' | 'failed' | 'pending'

export interface PayoutRow {
  booking_id: string
  provider_id: string
  provider_name: string
  amount: number
  momo_masked: string | null
  status: PayoutStatus
  provider_ref: string | null
  timestamp: string | null
}

export const financeApi = {
  overview: (params: { period: Period; from?: string; to?: string }) => {
    const q = new URLSearchParams({ period: params.period })
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    return api.get<FinanceOverview>(`/api/admin/finance/overview?${q}`)
  },

  commissions: (params: {
    page?: number
    category_id?: number
    tier?: string
    status?: CommissionStatus | ''
    date_from?: string
    date_to?: string
  }) => {
    const q = new URLSearchParams()
    q.set('page', String(params.page ?? 1))
    if (params.category_id) q.set('category_id', String(params.category_id))
    if (params.tier) q.set('tier', params.tier)
    if (params.status) q.set('status', params.status)
    if (params.date_from) q.set('date_from', params.date_from)
    if (params.date_to) q.set('date_to', params.date_to)
    return api.get<Paginated<CommissionRow>>(`/api/admin/finance/commissions?${q}`)
  },

  commissionBands: () => api.get<{ data: CommissionBand[] }>('/api/admin/finance/commission-bands'),

  updateCommissionBand: (categoryId: number, payload: { rates: Record<string, number>; reason: string }) =>
    api.patch<{ data: CommissionBand[] }>(`/api/admin/finance/commission-bands/${categoryId}`, payload),

  escrow: (params: { page?: number; type?: PaymentEventType | '' }) => {
    const q = new URLSearchParams()
    q.set('page', String(params.page ?? 1))
    if (params.type) q.set('type', params.type)
    return api.get<Paginated<EscrowRow>>(`/api/admin/finance/escrow?${q}`)
  },

  payouts: (params: { page?: number; provider_id?: string; status?: PayoutStatus | '' }) => {
    const q = new URLSearchParams()
    q.set('page', String(params.page ?? 1))
    if (params.provider_id) q.set('provider_id', params.provider_id)
    if (params.status) q.set('status', params.status)
    return api.get<Paginated<PayoutRow>>(`/api/admin/finance/payouts?${q}`)
  },

  retryPayout: (bookingId: string, payload: { reason: string }) =>
    api.post<Paginated<PayoutRow>>(`/api/admin/finance/payouts/${bookingId}/retry`, payload),
}
