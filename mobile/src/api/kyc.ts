import { api } from './client';

export type DocType = 'NRC' | 'PASSPORT' | 'DRIVERS_LICENSE';

export type DocStatus =
  | 'SUBMITTED'
  | 'AUTO_APPROVED'
  | 'AUTO_REJECTED'
  | 'MANUAL_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED';

export interface KycDocument {
  id: string;
  doc_type: string;
  status: DocStatus;
  // true when an admin asked for more information (item awaits the applicant)
  info_requested: boolean;
  // applicant-facing note: the admin's "needs info" message or rejection reason
  review_note: string | null;
  confidence_score: number | null;
  submitted_at: string;
  reviewed_at: string | null;
}

export interface KycStatus {
  trust_tier: number;
  trust_score: number;
  kyc_status: string;
  documents: KycDocument[];
  can_resubmit: boolean;
}

export interface SubmitDocumentResponse {
  document_id: string;
  status: DocStatus;
}

/**
 * Build multipart FormData for file uploads.
 * React Native's fetch accepts { uri, type, name } objects as file fields.
 */
function buildForm(fields: Record<string, string | { uri: string; type: string; name: string }>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    (form as any).append(key, value);
  }
  return form;
}

export const kycApi = {
  getStatus: () =>
    api.get<KycStatus>('/kyc/'),

  /** Tier 1 — selfie + legal name */
  submitTier1: (legalName: string, selfieUri: string) => {
    const form = buildForm({
      legal_name: legalName,
      selfie: { uri: selfieUri, type: 'image/jpeg', name: 'selfie.jpg' },
    });
    return api.upload<SubmitDocumentResponse>('/kyc/tier1', form);
  },

  /** Tier 2 — government ID + selfie */
  submitDocument: (docType: DocType, documentUri: string, selfieUri: string) => {
    const form = buildForm({
      doc_type: docType,
      document: { uri: documentUri, type: 'image/jpeg', name: 'document.jpg' },
      selfie:   { uri: selfieUri,   type: 'image/jpeg', name: 'selfie.jpg' },
    });
    return api.upload<SubmitDocumentResponse>('/kyc/document', form);
  },

  /** Tier 3 — proof of address */
  submitAddress: (documentUri: string) => {
    const form = buildForm({
      document: { uri: documentUri, type: 'image/jpeg', name: 'address.jpg' },
    });
    return api.upload<SubmitDocumentResponse>('/kyc/address', form);
  },
};
