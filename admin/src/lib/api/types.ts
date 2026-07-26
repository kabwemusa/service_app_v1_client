// ─── Admin roles ────────────────────────────────────────────────────────────
export type AdminRole =
  | 'super_admin'
  | 'trust_safety'
  | 'finance'
  | 'moderator'
  | 'support'
  | 'analyst'
  | 'ops'

// ─── Capability strings ──────────────────────────────────────────────────────
// Every gate in the UI is checked against a capability, never against a role string.
export type Capability =
  | 'read:dashboard'
  | 'read:users'
  | 'write:users'
  | 'suspend:users'
  | 'ban:users'
  | 'users.view_pii'
  | 'users.moderate'
  | 'users.adjust_tier'
  | 'read:bookings'
  | 'read:services'
  | 'services.moderate'
  | 'read:categories'
  | 'write:categories'
  | 'categories.manage'
  | 'categories.set_band'
  | 'read:reviews'
  | 'write:reviews'
  | 'reviews.moderate'
  | 'read:verification'
  | 'write:verification'
  | 'read:disputes'
  | 'write:disputes'
  | 'read:safety'
  | 'write:safety'
  | 'safety.handle'
  | 'read:fraud'
  | 'write:fraud'
  | 'write:denylist'
  | 'read:promotions'
  | 'write:promotions'
  | 'read:banners'
  | 'write:banners'
  | 'read:commissions'
  | 'write:commissions'
  | 'read:payouts'
  | 'write:payouts'
  | 'read:subscriptions'
  | 'write:subscriptions'
  | 'read:insights'
  | 'read:settings'
  | 'write:settings'
  | 'legal.manage'
  | 'manage:admins'
  | 'read:audit'
  | 'write:platform_params'
  | 'platform.ops'

// ─── Admin JWT payload (decoded client-side; signature verified by Laravel) ──
export interface AdminTokenPayload {
  sub: string
  email: string
  name: string
  role: AdminRole
  capabilities: Capability[]
  avatar_url?: string
  iat: number
  exp: number
  // step_up: true when the token was issued after a step-up challenge
  step_up?: boolean
}

// ─── Audit log ───────────────────────────────────────────────────────────────
export interface AuditLogEntry {
  id: string
  actor_admin_id: string
  actor_name: string
  actor_role: AdminRole
  action: string
  target_type: string
  target_id: string
  reason: string
  metadata: {
    before?: Record<string, unknown>
    after?: Record<string, unknown>
  }
  ip: string
  user_agent: string
  created_at: string
}

// ─── Paginated API response wrapper ──────────────────────────────────────────
export interface Paginated<T> {
  data: T[]
  meta: {
    current_page: number
    last_page: number
    per_page: number
    total: number
  }
}

// ─── Standard API error ──────────────────────────────────────────────────────
export interface ApiError {
  message: string
  errors?: Record<string, string[]>
  code?: string
}

// ─── Domain stubs (module implementations fill these out) ────────────────────

export type AccountState = 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED' | 'BANNED' | 'PENDING_CLOSURE'
export type TrustTier = 0 | 1 | 2 | 3 | 4
export type KycStatus = 'SUBMITTED' | 'AUTO_APPROVED' | 'AUTO_REJECTED' | 'MANUAL_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
export type BookingStatus = 'PENDING_PAYMENT' | 'FUNDS_HELD' | 'AWAITING_KYC' | 'IN_PROGRESS' | 'DELIVERED' | 'COMPLETED' | 'DISBURSED' | 'DISPUTED' | 'CANCELLED' | 'CHARGEBACK_PENDING'
export type DisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_EVIDENCE' | 'RESOLVED_BUYER' | 'RESOLVED_PROVIDER' | 'RESOLVED_PARTIAL' | 'WITHDRAWN'
export type SubscriptionPlan = 'FREE' | 'PRO' | 'ELITE'
export type SubscriptionStatus = 'ACTIVE' | 'GRACE' | 'CANCELLED' | 'EXPIRED'

export interface UserSummary {
  id: string
  email: string
  phone?: string
  display_name: string
  account_state: AccountState
  trust_tier: TrustTier
  role: 'CUSTOMER' | 'PROVIDER'
  created_at: string
}

export interface BookingSummary {
  id: string
  provider_id: string
  customer_id: string
  service_title: string
  amount: number
  status: BookingStatus
  created_at: string
}

export interface DisputeSummary {
  id: string
  booking_id: string
  raised_by_id: string
  against_id: string
  reason_category: string
  status: DisputeStatus
  opened_at: string
}

export interface PlatformParam {
  key: string
  value: string
  description: string
  updated_at: string
  updated_by: string
}
