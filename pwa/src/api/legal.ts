import { api } from './client';

// Shared legal content + consent mechanism, identical contract to the mobile app
// (mobile/src/api/legal.ts) against the same backend — app + PWA parity.

export type LegalDocumentType = 'terms_of_service' | 'privacy_policy' | 'user_agreement';

export interface LegalSection {
  id: string;
  title: string;
  level: number;
  body: string; // markdown
}

export interface LegalDocumentMeta {
  type: LegalDocumentType;
  version: string;
  status: 'draft' | 'published' | 'archived';
  title: string;
  summary: string | null;
  effective_date: string | null;
  last_updated: string | null;
}

export interface LegalDocument extends LegalDocumentMeta {
  draft_mode: boolean;
  content: { intro: string; sections: LegalSection[] };
}

export interface LegalIndex {
  draft_mode: boolean;
  documents: LegalDocumentMeta[];
}

export interface ConsentStatus {
  needs_consent: boolean;
  reason: 'NEW' | 'VERSION_CHANGE' | null;
  core_withdrawn: boolean;
  outstanding: { type: LegalDocumentType; version: string | null }[];
  required: { type: LegalDocumentType; version: string; title: string; effective_date: string | null }[];
  marketing_opt_in: boolean;
  analytics_opt_in: boolean;
  accepted: Record<string, string>;
}

export type DataSubjectRequestType =
  | 'ACCESS' | 'RECTIFICATION' | 'ERASURE' | 'OBJECTION'
  | 'RESTRICTION' | 'PORTABILITY' | 'WITHDRAW_CONSENT';

const appVersion = '1.0.0';
const platform = 'pwa';

export const legalApi = {
  listDocuments: () => api.get<LegalIndex>('/legal/documents'),
  getDocument: (type: LegalDocumentType) => api.get<LegalDocument>(`/legal/documents/${type}`),

  status: () => api.get<ConsentStatus>('/me/consent', true),

  accept: (opts: { marketing: boolean; analytics: boolean }) =>
    api.post<{ consent_id: string; status: ConsentStatus }>('/me/consent', {
      accept_required: true,
      marketing: opts.marketing,
      analytics: opts.analytics,
      platform,
      app_version: appVersion,
    }, true),

  decline: () => api.post<null>('/me/consent/decline', { platform, app_version: appVersion }, true),

  withdraw: (scope: 'marketing' | 'analytics' | 'CORE') =>
    api.post<{ status: ConsentStatus }>('/me/consent/withdraw', { scope, platform, app_version: appVersion }, true),

  submitDataRequest: (type: DataSubjectRequestType, details?: string) =>
    api.post<{ request_id: string; type: string; status: string }>('/me/data-requests', { type, details }, true),
};
