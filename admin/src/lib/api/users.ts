// ─── Users module data layer ─────────────────────────────────────────────────
//
// The central people record (§4 tiers/KYC, §5.1 provider signals, §6.4 denylist,
// §10.2 risk, §11.3 safety). Other modules (Services / Reviews / Safety / Fraud)
// deep-link into the detail drawer via ?user=<id>.
//
// PRIVACY:
//   - Contact / identity fields arrive MASKED in list & detail. The raw values
//     are only fetched via revealPii(), which the backend logs as a PII-access
//     audit entry. Gated on users.view_pii.
//   - `avatar_url` is the public provider avatar — NEVER the KYC selfie.
//   - `internal` (trust_score / risk_score) is only populated for admins holding
//     read:fraud and must never be rendered outside the admin surface.
//   - Moderation/denylist/tier mutations run ONLY through useAuditedMutation; the
//     wrapper appends { reason } and the API writes the audit entry + state change
//     in one transaction. Denylist stores hashes only — raw values never sent.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'
import type { Paginated, AccountState, TrustTier, KycStatus } from '@/lib/api/types'
import type { StatusVariant } from '@/components/ui/StatusPill'

export type UserRoleLabel = 'customer' | 'provider' | 'both' | 'staff'

// Derived display status (distinct from the raw AccountState enum). "warned" is
// an ACTIVE account that has received a warning notice.
export type AccountStatus =
  | 'active'
  | 'warned'
  | 'restricted'
  | 'suspended'
  | 'banned'
  | 'pending_closure'

export interface UserRow {
  id: string
  display_name: string
  role: UserRoleLabel
  is_provider: boolean
  trust_tier: TrustTier
  account_status: AccountStatus
  // Key signal: rating (when reviewed) or cancellation_rate (providers).
  rating: number | null
  reviews_count: number
  cancellation_rate: number | null
  flagged: boolean
  created_at: string
}

export interface MaskedContact {
  has_email: boolean
  has_phone: boolean
  has_legal_name: boolean
  email_masked: string | null
  phone_masked: string | null
  legal_name_masked: string | null
}

export interface RevealedPii {
  email: string | null
  phone: string | null
  legal_name: string | null
  momo_number: string | null
}

export interface UserActivity {
  bookings_count: number
  recent_bookings: Array<{
    id: string
    service_title: string
    status: string
    amount: number
    role: 'customer' | 'provider'
    created_at: string
  }>
  services_count: number
  services: Array<{ id: string; title: string; status: string }>
  reviews_given: number
  reviews_received: number
  reports_filed: number
  reports_against: number
  referrals_count: number
}

export interface UserDetail {
  id: string
  display_name: string
  avatar_url: string | null
  role: UserRoleLabel
  is_provider: boolean
  account_state: AccountState
  account_status: AccountStatus
  trust_tier: TrustTier
  tier_label: string
  verification_state: KycStatus | null
  warned_at: string | null
  suspended_until: string | null
  // Latest moderation reason from the audit trail (for read-only state display).
  moderation_reason: string | null
  contact: MaskedContact
  signals: {
    rating: number | null
    reviews_count: number
    cancellation_rate: number | null
    response_rate: number | null
  }
  // Internal-only composite scores. null unless the admin holds read:fraud.
  internal: { trust_score: number | null; risk_score: number } | null
  activity: UserActivity
  // DIRECT-mode advisory finance (no money moves).
  finance: { gmv: number; commission_due_uncollected: number }
  created_at: string
  last_active_at: string | null
}

// ─── Display maps ──────────────────────────────────────────────────────────────

export const ROLE_LABEL: Record<UserRoleLabel, string> = {
  customer: 'Customer',
  provider: 'Provider',
  both: 'Customer + Provider',
  staff: 'Staff',
}

export const STATUS_LABEL: Record<AccountStatus, string> = {
  active: 'Active',
  warned: 'Warned',
  restricted: 'Restricted',
  suspended: 'Suspended',
  banned: 'Banned',
  pending_closure: 'Pending closure',
}

export const STATUS_VARIANT: Record<AccountStatus, StatusVariant> = {
  active: 'active',
  warned: 'warning',
  restricted: 'restricted',
  suspended: 'suspended',
  banned: 'banned',
  pending_closure: 'neutral',
}

export const TIER_LABEL: Record<TrustTier, string> = {
  0: 'Unverified',
  1: 'Basic',
  2: 'Identified',
  3: 'Verified',
  4: 'Professional',
}

// §6.4 denylist reason categories.
export type DenylistCategory =
  | 'CONFIRMED_FRAUD'
  | 'SERIAL_DISPUTE'
  | 'IDENTITY_FRAUD'
  | 'OFF_PLATFORM_ATTEMPT'
  | 'CHARGEBACK_ABUSE'
  | 'ADMIN_MANUAL'

export const DENYLIST_CATEGORY_LABEL: Record<DenylistCategory, string> = {
  CONFIRMED_FRAUD: 'Confirmed fraud',
  SERIAL_DISPUTE: 'Serial disputes',
  IDENTITY_FRAUD: 'Identity fraud',
  OFF_PLATFORM_ATTEMPT: 'Off-platform attempt',
  CHARGEBACK_ABUSE: 'Chargeback abuse',
  ADMIN_MANUAL: 'Admin manual',
}

// Identifier kinds resolvable from the user record (raw value stays server-side;
// only its hash is stored). §6.4 also supports NRC/passport/device hashes, which
// originate in the KYC/device pipelines rather than this surface.
export type DenylistIdentifier = 'PHONE_HASH' | 'EMAIL_HASH' | 'MOMO_NUMBER_HASH'

export const DENYLIST_IDENTIFIER_LABEL: Record<DenylistIdentifier, string> = {
  PHONE_HASH: 'Phone number',
  EMAIL_HASH: 'Email address',
  MOMO_NUMBER_HASH: 'Mobile-money number',
}

// ─── Query params ────────────────────────────────────────────────────────────

export interface UserQueryParams {
  page?: number
  search?: string
  role?: UserRoleLabel | ''
  status?: AccountStatus | ''
  tier?: '' | '0' | '1' | '2' | '3' | '4'
  flagged?: '' | '1'
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const usersApi = {
  list: (params: UserQueryParams) => {
    const q = new URLSearchParams()
    q.set('page', String(params.page ?? 1))
    if (params.search) q.set('search', params.search)
    if (params.role) q.set('role', params.role)
    if (params.status) q.set('status', params.status)
    if (params.tier) q.set('tier', params.tier)
    if (params.flagged) q.set('flagged', params.flagged)
    return api.get<Paginated<UserRow>>(`/api/admin/users?${q}`)
  },

  detail: (id: string) => api.get<UserDetail>(`/api/admin/users/${id}`),

  // Gated on users.view_pii; the backend logs a PII-access audit entry.
  revealPii: (id: string) => api.post<RevealedPii>(`/api/admin/users/${id}/reveal-pii`),

  // ── Moderation (all via useAuditedMutation — reason appended by the wrapper) ──
  warn: (id: string, payload: { reason: string }) =>
    api.post<UserDetail>(`/api/admin/users/${id}/warn`, payload),

  suspend: (id: string, payload: { reason: string; duration_days?: number | null }) =>
    api.post<UserDetail>(`/api/admin/users/${id}/suspend`, payload),

  // Ban requires step-up auth — attach the step-up token.
  ban: (id: string, payload: { reason: string }) =>
    api.post<UserDetail>(`/api/admin/users/${id}/ban`, payload, { stepUp: true }),

  reinstate: (id: string, payload: { reason: string }) =>
    api.post<UserDetail>(`/api/admin/users/${id}/reinstate`, payload),

  adjustTier: (id: string, payload: { tier: number; reason: string }) =>
    api.post<UserDetail>(`/api/admin/users/${id}/adjust-tier`, payload),

  // Denylist add requires step-up. Sends identifier KINDS only — never raw values.
  addToDenylist: (
    id: string,
    payload: { identifiers: DenylistIdentifier[]; category: DenylistCategory; reason: string },
  ) => api.post<UserDetail>(`/api/admin/users/${id}/denylist`, payload, { stepUp: true }),
}
