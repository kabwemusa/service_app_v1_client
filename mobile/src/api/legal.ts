import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './client';

// ── Versioned legal content (shared source with the PWA / website) ──────────

export type LegalDocumentType =
  | 'terms_of_service'
  | 'privacy_policy'
  | 'user_agreement';

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

// ── Consent (Data Protection Act No. 3 of 2021 — demonstrable consent) ──────

export interface ConsentStatus {
  needs_consent: boolean;
  reason: 'NEW' | 'VERSION_CHANGE' | null;
  core_withdrawn: boolean;
  outstanding: { type: LegalDocumentType; version: string | null }[];
  required: {
    type: LegalDocumentType;
    version: string;
    title: string;
    effective_date: string | null;
  }[];
  marketing_opt_in: boolean;
  analytics_opt_in: boolean;
  accepted: Record<string, string>;
}

export type DataSubjectRequestType =
  | 'ACCESS'
  | 'RECTIFICATION'
  | 'ERASURE'
  | 'OBJECTION'
  | 'RESTRICTION'
  | 'PORTABILITY'
  | 'WITHDRAW_CONSENT';

export interface DataSubjectRequest {
  id: string;
  type: DataSubjectRequestType;
  status: string;
  details: string | null;
  created_at: string;
  resolved_at: string | null;
}

// App version + platform ride on every consent event for the audit trail.
const appVersion =
  (Constants.expoConfig?.version as string | undefined) ?? '1.0.0';
const platform =
  Platform.OS === 'ios' ? 'mobile_ios' :
  Platform.OS === 'android' ? 'mobile_android' : 'mobile';

export const legalApi = {
  // Public — read anytime.
  listDocuments: () => api.get<LegalIndex>('/legal/documents'),
  getDocument: (type: LegalDocumentType) =>
    api.get<LegalDocument>(`/legal/documents/${type}`),

  // Authenticated — the consent mechanism.
  status: () => api.get<ConsentStatus>('/me/consent'),

  accept: (opts: { marketing: boolean; analytics: boolean }) =>
    api.post<{ consent_id: string; status: ConsentStatus }>('/me/consent', {
      accept_required: true,
      marketing: opts.marketing,
      analytics: opts.analytics,
      platform,
      app_version: appVersion,
    }),

  decline: () => api.post<null>('/me/consent/decline', { platform, app_version: appVersion }),

  withdraw: (scope: 'marketing' | 'analytics' | 'CORE') =>
    api.post<{ status: ConsentStatus }>('/me/consent/withdraw', {
      scope,
      platform,
      app_version: appVersion,
    }),

  // Data-subject rights capture (fulfilment handled out of band).
  submitDataRequest: (type: DataSubjectRequestType, details?: string) =>
    api.post<{ request_id: string; type: string; status: string }>('/me/data-requests', {
      type,
      details,
    }),
  listDataRequests: () =>
    api.get<{ requests: DataSubjectRequest[] }>('/me/data-requests'),
};
