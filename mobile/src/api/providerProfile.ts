import { api } from './client';

export type LanguageCode = 'en' | 'ny' | 'bem' | 'ton';

export interface Highlights {
  pinned_service_ids:  string[];
  featured_photo_keys: string[];
  featured_badges:     string[];
}

export interface ProviderProfile {
  user_id:              string;
  display_name:         string | null;
  bio:                  string | null;
  year_started:         number | null;
  languages:            LanguageCode[];
  nrc_number:           string | null;
  student_id_url:       string | null;
  kyc_status:           'PENDING' | 'VERIFIED' | 'REJECTED' | 'MANUAL_REVIEW' | 'AUTO_APPROVED' | 'AUTO_REJECTED' | 'SUBMITTED';
  trust_tier:           number;
  tier_label:           string;
  trust_score:          number;
  momo_provider:        'MTN' | 'AIRTEL' | 'ZAMTEL' | null;
  momo_number:          string | null;
  base_location_lat:    number | null;
  base_location_lng:    number | null;
  /** Area label for display (never coordinates, §4.1). */
  base_location_label?: string | null;
  max_radius_km:        number;
  service_radius_km:    number;
  availability_matrix:  Record<string, { start: string; end: string }[]> | null;
  cover_image_url:      string | null;
  portfolio_images:     string[];
  certifications:       any[];
  highlights:           Highlights;
  profile_completeness: number;
}

export interface ProfilePayload {
  display_name?:      string;
  bio?:               string;
  year_started?:      number;
  languages?:         LanguageCode[];
  nrc_number?:        string;
  momo_provider?:     'MTN' | 'AIRTEL' | 'ZAMTEL';
  momo_number?:       string;
  base_location_lat?: number;
  base_location_lng?: number;
  max_radius_km?:     number;
  service_radius_km?: number;
  highlights?:        Highlights;
  availability_matrix?: Record<string, { start: string; end: string }[]>;
}

// §6.5 Hub aggregate — GET /provider/dashboard
export interface ChecklistItem {
  key:    string;
  label:  string;
  points: number;
  done:   boolean;
}

export interface TierSummary {
  value:             number;
  label:             string;
  job_cap_zmw:       number | null;
  weekly_cap_zmw:    number | null;
  payout_hold_hours: number;
}

export interface NextTierSummary {
  value:        number;
  label:        string;
  requirements: string[];
  /** 0–1 fraction of requirements met (NEW — v3 §4.5) */
  progress?:    number;
  /** Human-readable list of what this tier unlocks (NEW — v3 §4.1) */
  unlocks?:     string[];
}

// §6.5/§9.3 Earnings tab aggregate — GET /provider/earnings
export interface EarningsEntry {
  booking_id:       string;
  service_title:    string | null;
  gross_zmw:        number;
  commission_rate:  number;
  net_zmw:          number;
  calculated_at:    string | null;
  paid:             boolean;
  eligible_at:      string | null;
}

export interface ProviderEarnings {
  /** DIRECT = paid directly by customers (no escrow/payouts) · ESCROW = platform payouts. */
  payment_mode: 'DIRECT' | 'ESCROW';
  tier: TierSummary;
  summary: {
    this_week_zmw:   number;
    this_month_zmw:  number;
    lifetime_zmw:    number;
    weekly_cap_zmw:  number | null;
  };
  next_payout: {
    booking_id:  string;
    amount_zmw:  number;
    eligible_at: string | null;
  } | null;
  instant_payout: {
    eligible: boolean;
    fee_rate: number;
  };
  recent: EarningsEntry[];
}

export interface ProviderDashboard {
  /** DIRECT = paid directly by customers (no escrow/payouts) · ESCROW = platform payouts. */
  payment_mode:          'DIRECT' | 'ESCROW';
  tier:                  TierSummary;
  next_tier:             NextTierSummary | null;
  profile_completeness:  number;
  checklist: {
    items: ChecklistItem[];
    next:  { key: string; label: string; points: number } | null;
  };
  earned_badges: string[];
  /**
   * Ordered path to being visible in search — mirrors the backend search
   * gates (Tier ≥ 1, profile strength ≥ 40, ≥ 1 ACTIVE service).
   */
  listing?: {
    listed: boolean;
    steps: { key: string; label: string; done: boolean }[];
  };
  earnings: {
    this_week_zmw:  number;
    weekly_cap_zmw: number | null;
    /** 'up' | 'down' | 'flat' vs previous week (NEW) */
    trend?:         'up' | 'down' | 'flat';
  };
  /** DIRECT only — completed jobs the provider hasn't yet confirmed paid. */
  to_collect?: { amount_zmw: number; count: number } | null;
  /** §9.6 referral entry — 8-char code. */
  referral_code?: string | null;
  next_payout: {
    booking_id:  string;
    amount_zmw:  number;
    eligible_at: string | null;
  } | null;
  instant_payout: {
    eligible: boolean;
    fee_rate: number;
  };

  /** Available/Away toggle — persists server-side (NEW — v3.1 availability concept) */
  accepting_bookings?:  boolean;
  /** Public profile photo URL — NOT the KYC selfie (NEW — maps to cover_image_url) */
  profile_photo_url?:   string | null;
  /** Provider display name for header (NEW) */
  display_name?:        string | null;
  /** Unread notification count for badge (NEW) */
  notifications_count?: number;
  /** TODAY aggregate (NEW) */
  today?: {
    new_requests: number;
    next_job: {
      service_title:  string;
      scheduled_at:   string;
      location_label: string;
    } | null;
  };
  /** Key performance stats (NEW — v3 §5.1, §7.1) */
  stats?: {
    rating:                 number | null;
    reviews?:               number;
    response_time_p50_mins: number | null;
    repeat_client_rate:     number | null;
    jobs_done:              number;
    active_services?:       number;
  };
  /** Current subscription plan (NEW — v3 §8.4) */
  subscription?: {
    plan: 'FREE' | 'PRO' | 'ELITE';
  };
}

export const providerProfileApi = {
  get: () =>
    api.get<ProviderProfile>('/provider/profile'),

  upsert: (payload: ProfilePayload) =>
    api.put<ProviderProfile>('/provider/profile', payload),

  dashboard: () =>
    api.get<ProviderDashboard>('/provider/dashboard'),

  earnings: () =>
    api.get<ProviderEarnings>('/provider/earnings'),

  uploadKyc: (uri: string) => {
    const formData = new FormData();
    const fileName = uri.split('/').pop() ?? 'student_id.jpg';
    const fileType = fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    // React Native FormData accepts this shape for file uploads
    (formData as any).append('student_id', { uri, name: fileName, type: fileType });
    return api.upload<ProviderProfile>('/provider/profile/kyc', formData);
  },

  uploadCoverPhoto: (uri: string) => {
    const formData = new FormData();
    const fileName = uri.split('/').pop() ?? 'cover.jpg';
    (formData as any).append('photo', { uri, name: fileName, type: 'image/jpeg' });
    return api.upload<ProviderProfile>('/provider/profile/cover-photo', formData);
  },

  uploadPortfolioImage: (uri: string) => {
    const formData = new FormData();
    const fileName = uri.split('/').pop() ?? 'portfolio.jpg';
    (formData as any).append('photo', { uri, name: fileName, type: 'image/jpeg' });
    return api.upload<ProviderProfile>('/provider/profile/portfolio', formData);
  },

  deletePortfolioImage: (path: string) =>
    api.delete<ProviderProfile>(`/provider/profile/portfolio?path=${encodeURIComponent(path)}`),

  /**
   * Persist Available/Away toggle — v3.1 availability concept.
   * PATCH /provider/profile/availability-status
   * Away: stops NEW booking requests; does NOT affect confirmed bookings.
   */
  toggleAcceptingBookings: (accepting: boolean) =>
    api.patch<{ accepting_bookings: boolean }>('/provider/profile/availability-status', { accepting_bookings: accepting }),
};
