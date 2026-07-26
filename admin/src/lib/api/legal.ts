// ─── Admin Legal + Consent API module ──────────────────────────────────────
//
// Lets legal/compliance manage the versioned agreements (Terms, Privacy, User
// Agreement) and action data-subject requests — no code change required. All
// mutations flow through the audited-mutation wrapper (a reason is always logged;
// see AuditedMutationService). Guarded server-side by `legal.manage`.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '@/lib/api/client'

export type LegalDocumentType = 'terms_of_service' | 'privacy_policy' | 'user_agreement'
export type LegalStatus = 'draft' | 'published' | 'archived'

export interface LegalSection {
  id: string
  title: string
  level: number
  body: string
}

export interface LegalVersionSummary {
  id: string
  type: LegalDocumentType
  version: string
  status: LegalStatus
  title: string
  is_material: boolean
  effective_date: string | null
  section_count: number
  updated_at: string | null
}

export interface LegalDocumentDetail extends LegalVersionSummary {
  summary: string | null
  content: { intro: string; sections: LegalSection[] }
}

export interface LegalGroup {
  type: LegalDocumentType
  label: string
  current_version: string | null
  current_id: string | null
  versions: LegalVersionSummary[]
}

export interface LegalIndex {
  draft_mode: boolean
  groups: LegalGroup[]
}

export interface DataSubjectRequestRow {
  id: string
  user_id: string
  user_phone: string | null
  type: string
  status: 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED'
  details: string | null
  resolution_note: string | null
  created_at: string
  resolved_at: string | null
}

interface ApiSuccess<T> { data: T; message: string }

// Payloads (the audited-mutation wrapper appends `reason`).
export interface CreateVersionPayload {
  type: LegalDocumentType
  version: string
  title: string
  summary?: string | null
  is_material?: boolean
  content: { intro: string; sections: LegalSection[] }
  reason: string
}

export interface UpdateVersionPayload {
  title?: string
  summary?: string | null
  version?: string
  is_material?: boolean
  content?: { intro: string; sections: LegalSection[] }
  reason: string
}

export const legalAdminApi = {
  list: () => api.get<ApiSuccess<LegalIndex>>('/api/admin/legal/documents'),

  get: (id: string) => api.get<ApiSuccess<LegalDocumentDetail>>(`/api/admin/legal/documents/${id}`),

  create: (payload: CreateVersionPayload) =>
    api.post<ApiSuccess<LegalDocumentDetail>>('/api/admin/legal/documents', payload),

  update: (id: string, payload: UpdateVersionPayload) =>
    api.patch<ApiSuccess<LegalDocumentDetail>>(`/api/admin/legal/documents/${id}`, payload),

  publish: (id: string, payload: { effective_date?: string | null; reason: string }) =>
    api.post<ApiSuccess<LegalDocumentDetail>>(`/api/admin/legal/documents/${id}/publish`, payload),

  archive: (id: string, payload: { reason: string }) =>
    api.post<ApiSuccess<LegalDocumentDetail>>(`/api/admin/legal/documents/${id}/archive`, payload),

  remove: (id: string, payload: { reason: string }) =>
    api.delete<ApiSuccess<null>>(`/api/admin/legal/documents/${id}`, { body: payload }),

  dataRequests: (params?: { status?: string; type?: string }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.type) q.set('type', params.type)
    const qs = q.toString()
    return api.get<ApiSuccess<{ requests: DataSubjectRequestRow[]; meta: { current_page: number; last_page: number; total: number } }>>(
      `/api/admin/legal/data-requests${qs ? `?${qs}` : ''}`,
    )
  },

  updateDataRequest: (id: string, payload: { status: string; resolution_note?: string; reason: string }) =>
    api.patch<ApiSuccess<{ id: string; status: string; resolved_at: string | null }>>(
      `/api/admin/legal/data-requests/${id}`, payload,
    ),
}

// ── Display helpers ──────────────────────────────────────────────────────────

export const DOC_LABEL: Record<LegalDocumentType, string> = {
  terms_of_service: 'Terms of Service',
  privacy_policy: 'Privacy Policy',
  user_agreement: 'User Agreement',
}

// Maps a document status to a StatusPill variant (see StatusPill.StatusVariant).
export const STATUS_VARIANT: Record<LegalStatus, 'active' | 'info' | 'neutral'> = {
  published: 'active',
  draft: 'info',
  archived: 'neutral',
}
