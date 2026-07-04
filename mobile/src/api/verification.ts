import { api } from './client';

/**
 * Provider verification ladder — mirrors the SERVER eligibility gates
 * (ProviderVerificationService::status). This surface never grants a tier; it
 * reflects what the dispatch gate requires and what the provider has cleared.
 *
 *   Tier 1 "Identified"      — NRC + Mobile Money match  → remote & digital jobs
 *   Tier 2 "Trusted"         — portfolio (3–8 photos)     → public-venue jobs
 *   Tier 3 "In-home cleared" — police clearance           → in-home jobs
 *   Tier 4 "Professional"    — EARNED (jobs + rating)     → promoted placement
 */

/** verification_type keys the gate can require (RealTrustEngine / onboarding ladder). */
export type VerificationType =
  | 'nrc'
  | 'momo_name_match'
  | 'portfolio'
  | 'police_clearance'
  | 'selfie_match';

/** Per-row live state (ProviderVerificationService). */
export type TierState =
  | 'DONE'
  | 'ADD'
  | 'UNDER_REVIEW'
  | 'NEEDS_CHANGES'
  | 'EARNED'
  | 'EARNED_PROGRESS';

export type TierKind = 'base' | 'upload' | 'earned';

export interface Tier4Progress {
  completed_jobs:  number;
  required_jobs:   number;
  avg_rating:      number | null;
  required_rating: number;
  upheld_disputes: number;
  jobs_met:        boolean;
  rating_met:      boolean;
  disputes_met:    boolean;
}

export interface VerificationTierRow {
  tier:               number;
  label:              string;
  unlocks:            string;
  requirement?:       string;
  kind:               TierKind;
  /** Only on upload tiers (portfolio / police_clearance). */
  verification_type?: VerificationType;
  state:              TierState;
  /** NEEDS_CHANGES — the reviewer's note. */
  reason?:            string | null;
  submission_id?:     string;
  /** UNDER_REVIEW — when it was submitted. */
  submitted_at?:      string;
  /** DONE (upload tiers) — clearance expiry, if any. */
  expires_at?:        string | null;
  /** EARNED / EARNED_PROGRESS. */
  progress?:          Tier4Progress;
}

/** A provider's own service currently blocked by the gate (with the exact miss). */
export interface PendingListing {
  service_id: string;
  title:      string | null;
  eligibility: {
    eligible:  boolean;
    missing:   string[]; // VerificationType[] | ['unverified'] | ['service_not_found']
    tier:      number;
    risk_tier: number;
  };
}

export interface VerificationStatus {
  current_tier:     number;
  tiers:            VerificationTierRow[];
  pending_review:   boolean;
  pending_listings: PendingListing[];
}

export interface SubmissionResponse extends VerificationStatus {}

function fileField(uri: string, name: string) {
  const isPdf = uri.toLowerCase().endsWith('.pdf');
  return { uri, name, type: isPdf ? 'application/pdf' : 'image/jpeg' };
}

export const verificationApi = {
  /** GET /provider/verification — the ladder + gate reasons. */
  status: () => api.get<VerificationStatus>('/provider/verification'),

  /** POST /provider/verification/portfolio — Tier 2 (3–8 images run the §5.3 pipeline). */
  submitPortfolio: (uris: string[]) => {
    const form = new FormData();
    uris.forEach((uri, i) =>
      (form as any).append('images[]', fileField(uri, `portfolio_${i + 1}.jpg`)),
    );
    return api.upload<SubmissionResponse>('/provider/verification/portfolio', form);
  },

  /** POST /provider/verification/police-clearance — Tier 3. Dates are YYYY-MM-DD. */
  submitPoliceClearance: (
    uri: string,
    certNumber: string,
    issuedOn: string,
    expiresOn?: string | null,
  ) => {
    const form = new FormData();
    (form as any).append('document', fileField(uri, 'police_clearance.jpg'));
    form.append('cert_number', certNumber);
    form.append('issued_on', issuedOn);
    if (expiresOn) form.append('expires_on', expiresOn);
    return api.upload<SubmissionResponse>('/provider/verification/police-clearance', form);
  },
};
