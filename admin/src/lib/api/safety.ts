// ─── Safety module data layer ────────────────────────────────────────────────
//
// The highest-sensitivity surface (§11.3 safety reports, §11.4 emergency events).
// It triages two record kinds and drives protective action.
//
// CONFIDENTIALITY:
//   - The reporter is the party in distress — their identity must NEVER leak to
//     the reported party or anything outward-facing. Names/contact arrive MASKED
//     in every list & detail response.
//   - Raw values come only from revealPii(), which the backend logs as a
//     PII-access audit entry. Gated on safety.handle.
//   - Opening a detail is itself a logged sensitive-data read (server-side).
//   - Case notes are internal — they live only in the audit log.
//   - Protective/escalation actions run ONLY through useAuditedMutation; the
//     wrapper appends { reason } and the API writes the audit entry + state
//     change in one transaction. This module RECORDS decisions; it never
//     contacts authorities itself, and suspending the reported user is a Users
//     module action (deep-linked, not duplicated).
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'
import type { AccountStatus } from '@/lib/api/users'

export type SafetyKind = 'report' | 'emergency'
export type Severity = 'EMERGENCY' | 'HIGH' | 'STANDARD'
// Normalised triage status (maps OPEN/UNDER_REVIEW/RESOLVED + ACTIVE/ACKNOWLEDGED).
export type TriageStatus = 'new' | 'investigating' | 'resolved'

export type SafetyCategory =
  | 'HARASSMENT' | 'VIOLENCE_THREAT' | 'UNSAFE_BEHAVIOR'
  | 'DISCRIMINATION' | 'STOLEN_PROPERTY' | 'OTHER'

export const CATEGORY_LABEL: Record<SafetyCategory, string> = {
  HARASSMENT: 'Harassment',
  VIOLENCE_THREAT: 'Violence or threat',
  UNSAFE_BEHAVIOR: 'Unsafe behaviour',
  DISCRIMINATION: 'Discrimination',
  STOLEN_PROPERTY: 'Stolen property',
  OTHER: 'Other',
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  EMERGENCY: 'Emergency',
  HIGH: 'High',
  STANDARD: 'Standard',
}

export const STATUS_LABEL: Record<TriageStatus, string> = {
  new: 'New',
  investigating: 'Investigating',
  resolved: 'Resolved',
}

export type ResolveOutcome = 'ACTION_TAKEN' | 'NO_ACTION' | 'REFERRED' | 'DUPLICATE'

export const OUTCOME_LABEL: Record<ResolveOutcome, string> = {
  ACTION_TAKEN: 'Action taken',
  NO_ACTION: 'No action needed',
  REFERRED: 'Referred / escalated',
  DUPLICATE: 'Duplicate',
}

// ─── Queue rows ──────────────────────────────────────────────────────────────

export interface BookingRef {
  id: string
  status: string
}

export interface EmergencyRow {
  id: string
  kind: 'emergency'
  severity: 'EMERGENCY'
  status: TriageStatus
  reporter_masked: string | null
  reported_masked: string | null
  booking: BookingRef | null
  location_label: string | null
  created_at: string
  // §11.4 — automatic 2-hour post-incident outreach; drives the SLA timer.
  outreach_due_at: string | null
}

export interface ReportRow {
  id: string
  kind: 'report'
  severity: 'HIGH' | 'STANDARD'
  category: SafetyCategory
  category_label: string
  status: TriageStatus
  reporter_masked: string | null
  reported_masked: string | null
  booking: BookingRef | null
  assigned_admin_name: string | null
  reported_at: string
}

export interface SafetyQueue {
  emergencies: EmergencyRow[]
  data: ReportRow[]
  meta: { current_page: number; last_page: number; per_page: number; total: number }
  counts: { emergencies_active: number; reports_open: number }
}

// ─── Detail ──────────────────────────────────────────────────────────────────

export interface MaskedContact {
  has_email: boolean
  has_phone: boolean
  has_legal_name: boolean
  email_masked: string | null
  phone_masked: string | null
  legal_name_masked: string | null
}

export interface PartyHistory {
  reports_against: number
  reports_filed: number
  open_disputes: number
}

export interface Party {
  user_id: string
  is_reporter: boolean
  display_masked: string | null
  role_label: string
  account_status: AccountStatus
  contact: MaskedContact
  history: PartyHistory
}

export interface BookingContext {
  id: string
  status: string
  service_title: string
  scheduled_start: string | null
  amount: number
  location_label: string | null
  location_region: string | null
}

export interface SafetyDetail {
  kind: SafetyKind
  id: string
  severity: Severity
  status: TriageStatus
  status_raw: string
  // report-only
  category?: SafetyCategory
  category_label?: string
  description?: string
  reported_at?: string
  contact_restricted?: boolean
  account_restricted?: boolean
  authority_escalated_at?: string | null
  super_admin_escalated?: boolean
  review_notes?: string | null
  // emergency-only
  location_label?: string | null
  created_at?: string
  outreach_due_at?: string | null
  resolved_at?: string | null
  // shared
  assigned: { admin_id: string; admin_name: string | null } | null
  outcome: ResolveOutcome | null
  reviewed_by_admin_name?: string | null
  reporter: Party | null
  reported: Party | null
  booking: BookingContext | null
}

export interface RevealedParties {
  reporter: { email: string | null; phone: string | null; legal_name: string | null } | null
  reported: { email: string | null; phone: string | null; legal_name: string | null } | null
}

// ─── Query params ────────────────────────────────────────────────────────────

export interface SafetyQueryParams {
  page?: number
  severity?: Severity | ''
  status?: TriageStatus | ''
  type?: SafetyCategory | ''
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const safetyApi = {
  queue: (params: SafetyQueryParams) => {
    const q = new URLSearchParams()
    q.set('page', String(params.page ?? 1))
    if (params.severity) q.set('severity', params.severity)
    if (params.status) q.set('status', params.status)
    if (params.type) q.set('type', params.type)
    return api.get<SafetyQueue>(`/api/admin/safety/queue?${q}`)
  },

  // Opening a record is a logged sensitive-data read (server-side).
  detail: (kind: SafetyKind, id: string) =>
    api.get<SafetyDetail>(`/api/admin/safety/${kind}/${id}`),

  // Gated on safety.handle; the backend logs a PII-access audit entry.
  revealPii: (kind: SafetyKind, id: string) =>
    api.post<RevealedParties>(`/api/admin/safety/${kind}/${id}/reveal-pii`),

  // ── Actions (reason appended by useAuditedMutation) ──
  claim: (kind: SafetyKind, id: string, payload: { reason: string }) =>
    api.post<SafetyDetail>(`/api/admin/safety/${kind}/${id}/claim`, payload),

  restrictContact: (kind: SafetyKind, id: string, payload: { reason: string }) =>
    api.post<SafetyDetail>(`/api/admin/safety/${kind}/${id}/restrict-contact`, payload),

  escalateAuthority: (kind: SafetyKind, id: string, payload: { reason: string }) =>
    api.post<SafetyDetail>(`/api/admin/safety/${kind}/${id}/escalate-authority`, payload),

  escalateSuperAdmin: (kind: SafetyKind, id: string, payload: { reason: string }) =>
    api.post<SafetyDetail>(`/api/admin/safety/${kind}/${id}/escalate-super-admin`, payload),

  resolve: (kind: SafetyKind, id: string, payload: { outcome: ResolveOutcome; reason: string }) =>
    api.post<SafetyDetail>(`/api/admin/safety/${kind}/${id}/resolve`, payload),

  // Internal case note — not a state change, so a plain POST (no confirm modal).
  addNote: (kind: SafetyKind, id: string, body: string) =>
    api.post<SafetyDetail>(`/api/admin/safety/${kind}/${id}/note`, { body }),
}
