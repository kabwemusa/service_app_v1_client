// ─── Verification queue data layer ───────────────────────────────────────────
//
// Consumes the backend KYC / identity-document review endpoints. This module
// only READS the automated-check engine's results (§4.3 pipeline, §5.3 image
// pipeline) and POSTs reviewer decisions — it never runs checks itself.
//
// PRIVACY: KYC artifacts (ID images, selfies, liveness data) are reviewer-only.
// Their signed URLs are fetched per-submission and are NEVER placed into any
// audited-mutation payload, audit metadata, or consumer-facing path. The public
// profile avatar is a separate field and is never the KYC selfie.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'
import type { Paginated, AccountState, TrustTier } from '@/lib/api/types'
import type { StatusVariant } from '@/components/ui/StatusPill'

// Submission types reviewed in the single queue (v3 §4). Each approved type
// grants the corresponding tier/capability; certifications attach to a profile.
export type SubmissionType =
  | 'TIER2_IDENTITY' // §4.1 Identified: government ID + liveness/selfie match
  | 'TIER3_ADDRESS' // §4.1/§4.4 Verified: proof of address + momo name match
  | 'TIER4_SKILL' // §4.1/§4.5 Professional: skill proof + 20 jobs @ ≥4.5
  | 'CERTIFICATION' // §5.2 trade certificate attached to a profile

// Queue-level review status (distinct from the document KycStatus enum).
export type VerificationStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'needs_info'

export type DecisionOutcome = 'approved' | 'rejected' | 'needs_info'

export interface ReviewerRef {
  id: string
  name: string
}

export interface VerificationSubmission {
  id: string
  type: SubmissionType
  status: VerificationStatus
  submitted_at: string
  // Short automated-check summary for the list row (no raw artifacts).
  auto_summary: string
  // When this item breaches SLA (§4.3: 24h for manual review). Null = no SLA.
  sla_due_at: string | null
  // Who has claimed the item ("in-review by {admin}"). Null = unclaimed.
  claimed_by: ReviewerRef | null
  applicant: {
    id: string
    // Public-facing name only in the list. Legal name is reviewer-only (detail).
    display_name: string
    account_state: AccountState
    current_tier: TrustTier
  }
  // Present once resolved; renders the read-only decision + reason.
  decision: {
    outcome: DecisionOutcome
    reason: string
    decided_by: string
    decided_at: string
  } | null
}

// ─── Detail payload ──────────────────────────────────────────────────────────

export type ArtifactKind =
  | 'id_document'
  | 'selfie'
  | 'proof_of_address'
  | 'certificate'
  | 'portfolio_item'

export interface VerificationArtifact {
  id: string
  kind: ArtifactKind
  // Short-lived signed URL, reviewer-scoped. Never logged or exposed publicly.
  url: string
  label: string
  doc_type?: string
}

// Read-only automated advice. The reviewer decides; the system advises (§4.3).
export interface AutomatedChecks {
  // §4.3.3 liveness / face-match (≥0.85 required)
  liveness?: { score: number; passed: boolean }
  // §4.3.2 document authenticity confidence
  authenticity?: { score: number; flags: string[] }
  // §4.3.4 denylist / database cross-check
  database_match?: { matched: boolean; source?: string }
  // §4.3.5 duplicate-account check (same identity hash)
  duplicate_identity?: { matched: boolean }
  // §4.3.1 image quality gate
  image_quality?: { passed: boolean; flag?: string }
  // §4.3.6 name consistency (fuzzy match to declared legal name)
  name_consistency?: { matched: boolean; distance?: number }
  // §5.3 image pipeline — NSFW classifier
  nsfw?: { flagged: boolean; score?: number }
  // §5.3 image pipeline — pHash reverse-image-search duplicate
  phash_duplicate?: { flagged: boolean; match_provider_id?: string }
}

// §4.5 Tier 4 platform-track-record gate.
export interface Tier4Prerequisites {
  completed_jobs: number
  required_jobs: number // 20
  avg_rating: number | null
  required_rating: number // 4.5
  upheld_disputes: number // must be 0
  jobs_met: boolean
  rating_met: boolean
  disputes_met: boolean
  all_met: boolean
}

// §5.2 certification metadata.
export interface CertificationMeta {
  cert_type: 'TRADE_CERT' | 'DIPLOMA' | 'LICENSE' | 'PORTFOLIO_ITEM'
  title: string
  issuer: string
  issued_on?: string
  expires_on?: string
}

// A single progression event in a submission's lifecycle (submitted →
// auto-checks → claimed → info requested → resubmitted → approved/rejected).
export interface TimelineEvent {
  at: string
  label: string
  actor: string
  status?: string
  note?: string
}

export interface VerificationDetail extends VerificationSubmission {
  applicant: VerificationSubmission['applicant'] & {
    // Reviewer-only fields — never leave the admin surface.
    legal_name?: string
    trust_score?: number // internal number (§5.4); never surfaced publicly
    prior_reviews: number
    prior_rejections: number
  }
  artifacts: VerificationArtifact[]
  automated: AutomatedChecks
  tier4?: Tier4Prerequisites // present for TIER4_SKILL
  certification?: CertificationMeta // present for CERTIFICATION
  timeline?: TimelineEvent[] // chronological progression
}

// ─── Display maps ────────────────────────────────────────────────────────────

export const SUBMISSION_TYPE_LABEL: Record<SubmissionType, string> = {
  TIER2_IDENTITY: 'Tier 2 · Identified',
  TIER3_ADDRESS: 'Tier 3 · Verified',
  TIER4_SKILL: 'Tier 4 · Professional',
  CERTIFICATION: 'Certification',
}

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  pending: 'Pending',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  needs_info: 'Needs info',
}

export const STATUS_VARIANT: Record<VerificationStatus, StatusVariant> = {
  pending: 'pending',
  in_review: 'under_review',
  approved: 'approved',
  rejected: 'rejected',
  needs_info: 'info',
}

// The tier an approval grants. Certifications attach to the profile without a
// tier change. Used only to describe the action in the confirm summary.
export const GRANTED_TIER: Record<SubmissionType, TrustTier | null> = {
  TIER2_IDENTITY: 2,
  TIER3_ADDRESS: 3,
  TIER4_SKILL: 4,
  CERTIFICATION: null,
}

export function isResolved(status: VerificationStatus): boolean {
  return status === 'approved' || status === 'rejected'
}

export interface SlaInfo {
  // true once past the due time
  breached: boolean
  // true when due within 6h (surfacing soon-to-breach items)
  dueSoon: boolean
  label: string
}

export function slaInfo(dueAt: string | null, now: number = Date.now()): SlaInfo | null {
  if (!dueAt) return null
  const due = new Date(dueAt).getTime()
  const diffMs = due - now
  const hours = Math.round(Math.abs(diffMs) / 3_600_000)
  if (diffMs < 0) {
    return { breached: true, dueSoon: false, label: `SLA breached · ${hours}h over` }
  }
  return {
    breached: false,
    dueSoon: diffMs <= 6 * 3_600_000,
    label: `Due in ${hours}h`,
  }
}

// ─── API ─────────────────────────────────────────────────────────────────────

export interface VerificationQueryParams {
  page?: number
  type?: SubmissionType | ''
  status?: VerificationStatus | ''
  sla?: 'breached' | 'due_soon' | ''
  search?: string
  // Default sort is oldest-pending first.
  sort?: 'oldest' | 'newest'
}

export const verificationApi = {
  list: (params: VerificationQueryParams) => {
    const q = new URLSearchParams()
    q.set('page', String(params.page ?? 1))
    q.set('sort', params.sort ?? 'oldest')
    if (params.type) q.set('type', params.type)
    if (params.status) q.set('status', params.status)
    if (params.sla) q.set('sla', params.sla)
    if (params.search) q.set('search', params.search)
    return api.get<Paginated<VerificationSubmission>>(`/api/admin/verifications?${q}`)
  },

  detail: (id: string) =>
    api.get<VerificationDetail>(`/api/admin/verifications/${id}`),

  // Claim/assignment — concurrency guard, not a state decision, so no reason.
  claim: (id: string) =>
    api.post<VerificationDetail>(`/api/admin/verifications/${id}/claim`),

  release: (id: string) =>
    api.post<VerificationDetail>(`/api/admin/verifications/${id}/release`),

  // Decisions — invoked ONLY through useAuditedMutation. The wrapper appends
  // { reason }; the API writes the audit entry + transitions tier/KYC state in
  // one transaction. The payload carries NO artifact data.
  approve: (id: string, payload: { reason: string }) =>
    api.post<VerificationDetail>(`/api/admin/verifications/${id}/approve`, payload),

  reject: (id: string, payload: { reason: string }) =>
    api.post<VerificationDetail>(`/api/admin/verifications/${id}/reject`, payload),

  requestInfo: (id: string, payload: { reason: string }) =>
    api.post<VerificationDetail>(`/api/admin/verifications/${id}/request-info`, payload),
}
