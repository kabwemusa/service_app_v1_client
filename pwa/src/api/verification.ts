import { api } from './client';

export type TierState = 'DONE' | 'ADD' | 'UNDER_REVIEW' | 'NEEDS_CHANGES' | 'EARNED' | 'EARNED_PROGRESS';

export interface Tier4Progress {
  completed_jobs: number;
  required_jobs: number;
  avg_rating: number | null;
  required_rating: number;
  upheld_disputes: number;
  jobs_met: boolean;
  rating_met: boolean;
  disputes_met: boolean;
}

export interface TierRow {
  tier: number;
  label: string;
  unlocks: string;
  requirement?: string;
  kind: 'base' | 'upload' | 'earned';
  verification_type?: 'portfolio' | 'police_clearance';
  state: TierState;
  reason?: string | null;
  submission_id?: string;
  submitted_at?: string;
  expires_at?: string | null;
  progress?: Tier4Progress;
}

export interface VerificationStatus {
  current_tier: number;
  tiers: TierRow[];
  pending_review: boolean;
  pending_listings: { service_id: string; title: string | null; eligibility: { missing: string[] } }[];
}

// All require the provider bearer token.
export const verificationApi = {
  status: () => api.get<VerificationStatus>('/provider/verification', true),

  policeClearance: (document: File, certNumber: string, issuedOn: string, expiresOn?: string) => {
    const f = new FormData();
    f.append('document', document);
    f.append('cert_number', certNumber);
    f.append('issued_on', issuedOn);
    if (expiresOn) f.append('expires_on', expiresOn);
    return api.postForm<VerificationStatus>('/provider/verification/police-clearance', f);
  },

  portfolio: (images: File[]) => {
    const f = new FormData();
    images.forEach((img) => f.append('images[]', img));
    return api.postForm<VerificationStatus>('/provider/verification/portfolio', f);
  },
};
