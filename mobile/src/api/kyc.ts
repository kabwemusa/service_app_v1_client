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

/**
 * Build a document file field from a picked URI. A government ID may be a photo
 * OR a single PDF scan — infer the mime + filename from the extension so the
 * backend (which allows jpg/png/webp/pdf) and the admin previewer treat it right.
 */
function docFile(uri: string, base: string): { uri: string; type: string; name: string } {
  const isPdf = uri.toLowerCase().split('?')[0].endsWith('.pdf');
  return isPdf
    ? { uri, type: 'application/pdf', name: `${base}.pdf` }
    : { uri, type: 'image/jpeg', name: `${base}.jpg` };
}

export const kycApi = {
  getStatus: () =>
    api.get<KycStatus>('/kyc/'),

  /** Tier 1 — legal name + NRC number + selfie (NRC is mandatory, § CTR-1) */
  submitTier1: (legalName: string, nrcNumber: string, selfieUri: string) => {
    const form = buildForm({
      legal_name: legalName,
      nrc_number: nrcNumber,
      selfie: { uri: selfieUri, type: 'image/jpeg', name: 'selfie.jpg' },
    });
    return api.upload<SubmitDocumentResponse>('/kyc/tier1', form);
  },

  /** Tier 2 — government ID (front + optional back, photo or PDF) + selfie */
  submitDocument: (docType: DocType, documentUri: string, selfieUri: string, documentBackUri?: string | null) => {
    const form = buildForm({
      doc_type: docType,
      document: docFile(documentUri, 'document_front'),
      selfie:   { uri: selfieUri, type: 'image/jpeg', name: 'selfie.jpg' },
      ...(documentBackUri ? { document_back: docFile(documentBackUri, 'document_back') } : {}),
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
