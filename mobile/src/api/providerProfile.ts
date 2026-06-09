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
  tier:                  TierSummary;
  next_tier:             NextTierSummary | null;
  profile_completeness:  number;
  checklist: {
    items: ChecklistItem[];
    next:  { key: string; label: string; points: number } | null;
  };
  earned_badges: string[];
  earnings: {
    this_week_zmw:  number;
    weekly_cap_zmw: number | null;
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
};
