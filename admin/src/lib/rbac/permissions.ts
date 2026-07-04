import type { AdminRole, Capability } from '@/lib/api/types'

// Every capability available in the system
export const ALL_CAPABILITIES: Capability[] = [
  'read:dashboard',
  'read:users', 'write:users', 'suspend:users', 'ban:users',
  'users.view_pii', 'users.moderate', 'users.adjust_tier',
  'read:bookings',
  'read:services', 'services.moderate',
  'read:categories', 'write:categories',
  'categories.manage', 'categories.set_band',
  'read:reviews', 'write:reviews', 'reviews.moderate',
  'read:verification', 'write:verification',
  'read:disputes', 'write:disputes',
  'read:safety', 'write:safety',
  'safety.handle',
  'read:fraud', 'write:fraud', 'write:denylist',
  'read:promotions', 'write:promotions',
  'read:banners', 'write:banners',
  'read:commissions', 'write:commissions',
  'read:payouts', 'write:payouts',
  'read:subscriptions', 'write:subscriptions',
  'read:insights',
  'read:settings', 'write:settings',
  'manage:admins',
  'read:audit',
  'write:platform_params',
  // WhatsApp & Conversation Ops module — nothing existing maps to it.
  'platform.ops',
]

// Capabilities granted to each role. RBAC is additive — no inheritance or
// wildcard denial. The API enforces this independently; the client uses it
// for UI gating only.
export const ROLE_CAPABILITIES: Record<AdminRole, Capability[]> = {
  super_admin: ALL_CAPABILITIES,

  trust_safety: [
    'read:dashboard',
    'read:users', 'write:users', 'suspend:users', 'ban:users',
    'users.view_pii', 'users.moderate', 'users.adjust_tier',
    'read:bookings',
    'read:services', 'services.moderate',
    'read:categories',
    'read:reviews', 'write:reviews', 'reviews.moderate',
    'read:verification', 'write:verification',
    'read:disputes', 'write:disputes',
    'read:safety', 'write:safety',
    'safety.handle',
    'read:fraud', 'write:fraud', 'write:denylist',
    'read:promotions',
  ],

  finance: [
    'read:dashboard',
    'read:users',
    'read:bookings',
    'read:services',
    'read:commissions', 'write:commissions',
    'read:payouts', 'write:payouts',
    'read:subscriptions',
    'categories.manage', 'categories.set_band',
  ],

  moderator: [
    'read:dashboard',
    'read:users',
    'read:bookings',
    'read:services', 'services.moderate',
    'read:categories',
    'categories.manage',
    'read:reviews', 'write:reviews', 'reviews.moderate',
    'read:disputes', 'write:disputes',
    'read:safety',
    'read:banners', 'write:banners',
  ],

  support: [
    'read:dashboard',
    'read:users', 'users.view_pii',
    'read:bookings',
    'read:services',
    'read:reviews',
    'read:promotions',
    'read:subscriptions',
  ],

  analyst: [
    'read:dashboard',
    'read:users',
    'read:bookings',
    'read:services',
    'read:categories',
    'read:reviews',
    'read:insights',
  ],

  ops: [
    'read:dashboard',
    'platform.ops',
  ],
}

// Capability required to VIEW each route.
// Routes not listed here are accessible to any authenticated admin.
export const ROUTE_CAPABILITY: Record<string, Capability> = {
  '/dashboard': 'read:dashboard',
  '/verification': 'read:verification',
  '/disputes': 'read:disputes',
  // Highest-sensitivity surface: trust_safety + super_admin only (NOT moderator).
  '/safety': 'safety.handle',
  '/fraud': 'read:fraud',
  '/users': 'read:users',
  '/bookings': 'read:bookings',
  '/services': 'read:services',
  // Page nav uses read:categories so existing JWT sessions aren't blocked.
  // The API endpoint itself is enforced by admin.can:categories.manage (backend).
  '/categories': 'read:categories',
  '/reviews': 'read:reviews',
  '/promotions': 'read:promotions',
  '/banners': 'read:banners',
  // Finance consolidates Commissions + Escrow + Payouts into one module.
  '/finance': 'read:commissions',
  '/subscriptions': 'read:subscriptions',
  '/insights': 'read:insights',
  '/settings': 'read:settings',
  '/settings/audit': 'read:audit',
  '/whatsapp': 'platform.ops',
}

// Actions that require a step-up (re-auth / MFA confirmation) regardless of
// the current session. The backend enforces this independently.
export const STEP_UP_CAPABILITIES: Capability[] = [
  'ban:users',
  'write:payouts',
  'write:commissions',
  'write:denylist',
  'write:platform_params',
  'manage:admins',
]

export function hasCapability(
  capabilities: Capability[],
  required: Capability,
): boolean {
  return capabilities.includes(required)
}

export function hasAnyCapability(
  capabilities: Capability[],
  required: Capability[],
): boolean {
  return required.some((c) => capabilities.includes(c))
}

export function needsStepUp(action: Capability): boolean {
  return STEP_UP_CAPABILITIES.includes(action)
}
