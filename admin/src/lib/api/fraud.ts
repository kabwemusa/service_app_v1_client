// ─── Admin Fraud & Denylist API module ─────────────────────────────────────
//
// Patterns tab surfaces signals computed from real existing data — never
// invented. Denylist stores hashes only; the raw identifier is never
// returned by the list/detail endpoints, only accepted on add.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'
import type { Paginated } from '@/lib/api/types'

export type SignalType = 'REVIEW_SPIKE' | 'FAILED_PAYMENTS' | 'DUPLICATE_IDENTITY' | 'DENYLIST_MATCH' | 'MOMO_REUSE' | 'SAFETY_ESCALATION'
export type SignalStatus = 'open' | 'investigating' | 'escalated' | 'false_positive' | 'resolved'
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH'

export const SIGNAL_TYPE_LABEL: Record<SignalType, string> = {
  REVIEW_SPIKE: 'Review bombing',
  FAILED_PAYMENTS: 'Repeated failed payments',
  DUPLICATE_IDENTITY: 'Duplicate identity',
  DENYLIST_MATCH: 'Denylist match (re-registration)',
  MOMO_REUSE: 'MoMo number reused across accounts',
  SAFETY_ESCALATION: 'High-severity safety report',
}

export interface AffectedUser {
  id: string | null
  name: string
}

export interface FraudSignal {
  signal_key: string
  signal_type: SignalType
  severity: Severity
  affected_users: AffectedUser[]
  source_module: string | null
  source_id: string | null
  detected_at: string
  status: SignalStatus
  assigned_admin_name: string | null
}

export type DenylistHashType = 'NRC_HASH' | 'PASSPORT_HASH' | 'PHONE_HASH' | 'EMAIL_HASH' | 'DEVICE_HASH' | 'MOMO_NUMBER_HASH'
export type DenylistCategory = 'CONFIRMED_FRAUD' | 'SERIAL_DISPUTE' | 'IDENTITY_FRAUD' | 'OFF_PLATFORM_ATTEMPT' | 'CHARGEBACK_ABUSE' | 'ADMIN_MANUAL'

export const DENYLIST_TYPE_LABEL: Record<DenylistHashType, string> = {
  NRC_HASH: 'NRC',
  PASSPORT_HASH: 'Passport',
  PHONE_HASH: 'Phone',
  EMAIL_HASH: 'Email',
  DEVICE_HASH: 'Device',
  MOMO_NUMBER_HASH: 'MoMo number',
}

export const DENYLIST_CATEGORY_LABEL: Record<DenylistCategory, string> = {
  CONFIRMED_FRAUD: 'Confirmed fraud',
  SERIAL_DISPUTE: 'Serial dispute',
  IDENTITY_FRAUD: 'Identity fraud',
  OFF_PLATFORM_ATTEMPT: 'Off-platform circumvention',
  CHARGEBACK_ABUSE: 'Chargeback abuse',
  ADMIN_MANUAL: 'Manual entry',
}

export interface DenylistEntry {
  id: string
  type: DenylistHashType
  masked: string
  reason: string
  added_at: string
  expires_at: string | null
  status: 'active' | 'lifted'
}

export const fraudApi = {
  patterns: (params: { status?: SignalStatus | ''; signal_type?: SignalType | '' }) => {
    const q = new URLSearchParams()
    if (params.status) q.set('status', params.status)
    if (params.signal_type) q.set('signal_type', params.signal_type)
    return api.get<{ data: FraudSignal[] }>(`/api/admin/fraud/patterns?${q}`)
  },

  claimSignal: (payload: { signal: FraudSignal; reason: string }) =>
    api.post(`/api/admin/fraud/patterns/claim`, payload),

  markFalsePositive: (payload: { signal: FraudSignal; reason: string }) =>
    api.post(`/api/admin/fraud/patterns/false-positive`, payload),

  escalateSignal: (payload: { signal: FraudSignal; reason: string }) =>
    api.post(`/api/admin/fraud/patterns/escalate`, payload),

  denylist: (params: { page?: number; type?: DenylistHashType | ''; status?: 'active' | 'lifted' | ''; search?: string }) => {
    const q = new URLSearchParams()
    q.set('page', String(params.page ?? 1))
    if (params.type) q.set('type', params.type)
    if (params.status) q.set('status', params.status)
    if (params.search) q.set('search', params.search)
    return api.get<Paginated<DenylistEntry>>(`/api/admin/fraud/denylist?${q}`)
  },

  addToDenylist: (payload: { hash_type: DenylistHashType; identifier: string; category: DenylistCategory; reason: string }) =>
    api.post<DenylistEntry>('/api/admin/fraud/denylist', payload),

  liftFromDenylist: (id: string, payload: { reason: string }) =>
    api.post<DenylistEntry>(`/api/admin/fraud/denylist/${id}/lift`, payload),

  exportDenylist: () => api.get<{ data: Array<{ hash_type: string; hash_value: string; reason: string; added_at: string }> }>('/api/admin/fraud/denylist/export'),

  escalations: () => api.get<{ data: FraudSignal[] }>('/api/admin/fraud/escalations'),
}
