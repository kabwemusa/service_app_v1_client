// ─── Admin dashboard overview API module ───────────────────────────────────
//
// Read-only marketplace-health counts for the landing dashboard. Every admin
// can read it; drilling into a queue enforces that module's own capability.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'

export interface DashboardOverview {
  kpis: {
    active_providers: number
    bookings_today: number
    open_disputes: number
    fraud_flags_24h: number
  }
  queues: {
    kyc_pending: number
    safety_open: number
    payouts_failed: number
  }
  generated_at: string
}

export const dashboardApi = {
  overview: () => api.get<DashboardOverview>('/api/admin/dashboard'),
}
