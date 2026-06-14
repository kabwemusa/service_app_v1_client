import type { AdminRole, Capability } from '@/lib/api/types'

// Every capability available in the system
export const ALL_CAPABILITIES: Capability[] = [
  'read:dashboard',
  'read:users', 'write:users', 'suspend:users', 'ban:users',
  'read:bookings',
  'read:services',
  'read:categories', 'write:categories',
  'read:reviews', 'write:reviews',
  'read:verification', 'write:verification',
  'read:disputes', 'write:disputes',
  'read:safety', 'write:safety',
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
]

// Capabilities granted to each role. RBAC is additive — no inheritance or
// wildcard denial. The API enforces this independently; the client uses it
// for UI gating only.
export const ROLE_CAPABILITIES: Record<AdminRole, Capability[]> = {
  super_admin: ALL_CAPABILITIES,

  trust_safety: [
    'read:dashboard',
    'read:users', 'write:users', 'suspend:users', 'ban:users',
    'read:bookings',
    'read:services',
    'read:categories',
    'read:reviews', 'write:reviews',
    'read:verification', 'write:verification',
    'read:disputes', 'write:disputes',
    'read:safety', 'write:safety',
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
  ],

  moderator: [
    'read:dashboard',
    'read:users',
    'read:bookings',
    'read:services',
    'read:categories',
    'read:reviews', 'write:reviews',
    'read:disputes', 'write:disputes',
    'read:safety',
    'read:banners', 'write:banners',
  ],

  support: [
    'read:dashboard',
    'read:users',
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
}

// Capability required to VIEW each route.
// Routes not listed here are accessible to any authenticated admin.
export const ROUTE_CAPABILITY: Record<string, Capability> = {
  '/dashboard': 'read:dashboard',
  '/verification': 'read:verification',
  '/disputes': 'read:disputes',
  '/safety': 'read:safety',
  '/fraud': 'read:fraud',
  '/users': 'read:users',
  '/bookings': 'read:bookings',
  '/services': 'read:services',
  '/categories': 'read:categories',
  '/reviews': 'read:reviews',
  '/promotions': 'read:promotions',
  '/banners': 'read:banners',
  '/commissions': 'read:commissions',
  '/payouts': 'read:payouts',
  '/subscriptions': 'read:subscriptions',
  '/insights': 'read:insights',
  '/settings': 'read:settings',
  '/settings/audit': 'read:audit',
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
