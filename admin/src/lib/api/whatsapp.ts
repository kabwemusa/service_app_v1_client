// ─── Admin WhatsApp & Conversation Ops API module ──────────────────────────
//
// Ops visibility, not a chat tool. Conversation rows carry STATE + METADATA
// only — message content is never fetched or shown here (it isn't persisted
// server-side for this module either).
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'
import type { Paginated } from '@/lib/api/types'

export interface WhatsAppOverview {
  kpis: {
    active_conversations_24h: number
    messages_received_today: number
    failed_sends_today: number
    conversation_to_booking_rate: number | null
  }
  volume: Array<{ date: string; sent: number; received: number }>
  mno_health: Array<{ mno: string; delivered: number; failed: number; other: number }>
}

export interface WhatsAppTemplate {
  name: string
  category: 'UTILITY' | 'MARKETING' | 'AUTH'
  language: string
  body: string
  params: string[]
}

export type ConversationView = '' | 'stuck' | 'failed' | 'completed'

export interface ConversationRow {
  id: string
  whatsapp_masked: string
  user_name: string
  state: string
  sub_state: string | null
  last_activity: string | null
  duration_mins: number | null
  booking_created: boolean
  stuck: boolean
}

export interface WebhookLogRow {
  id: string
  message_id: string | null
  from_masked: string | null
  kind: 'message' | 'status' | 'unparseable'
  type: string | null
  processing_status: 'processed' | 'failed' | 'duplicate'
  error: string | null
  created_at: string
}

export const whatsappApi = {
  overview: () => api.get<WhatsAppOverview>('/api/admin/whatsapp/overview'),

  templates: () => api.get<{ data: WhatsAppTemplate[] }>('/api/admin/whatsapp/templates'),

  conversations: (params: { page?: number; view?: ConversationView }) => {
    const q = new URLSearchParams()
    q.set('page', String(params.page ?? 1))
    if (params.view) q.set('view', params.view)
    return api.get<Paginated<ConversationRow>>(`/api/admin/whatsapp/conversations?${q}`)
  },

  nudge: (conversationId: string, payload: { reason: string }) =>
    api.post(`/api/admin/whatsapp/conversations/${conversationId}/nudge`, payload),

  markAbandoned: (conversationId: string, payload: { reason: string }) =>
    api.post(`/api/admin/whatsapp/conversations/${conversationId}/mark-abandoned`, payload),

  logs: (params: { page?: number; kind?: string; status?: string }) => {
    const q = new URLSearchParams()
    q.set('page', String(params.page ?? 1))
    if (params.kind) q.set('kind', params.kind)
    if (params.status) q.set('status', params.status)
    return api.get<Paginated<WebhookLogRow>>(`/api/admin/whatsapp/logs?${q}`)
  },
}
