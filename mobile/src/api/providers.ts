import { api } from './client';

export interface PublicService {
  id:            string;
  title:         string;
  description:   string | null;
  pricing_model: 'FIXED' | 'HOURLY' | 'QUOTE';
  base_price:    number | null;
  category:      { id: number; name: string };
  /** Provider pinned this service via highlights (shown first). */
  is_pinned:     boolean;
}

export interface PublicReview {
  id:          string;
  rating:      number;
  comment:     string | null;
  reviewer:    { id: string; name: string };
  created_at:  string;
}

export interface PublicProviderProfile {
  id:                   string;
  display_name:         string | null;
  bio:                  string | null;
  // Public profile photo (v3.1 schema note) — distinct from KYC selfie.
  avatar_url:           string | null;
  cover_image_url:      string | null;
  base_location_label:  string | null;
  trust_tier:           number;
  tier_label:           string;
  year_started:         number | null;
  languages:            string[];
  r_raw:                number;
  v_reviews:            number;
  /** null = provider has no booking history yet — render "–", not 0%. */
  completion_rate:      number | null;
  last_active_at:       string | null;
  jobs_done:            number;
  repeat_client_rate:   number | null;
  response_time_p50_mins: number | null;
  /** Badge keys the provider has actually earned (EARNED_BADGE_META). */
  earned_badges:        string[];
  /** Storage paths — render via storageUrl(). */
  portfolio_images:     string[];
  highlights: {
    pinned_service_ids:  string[];
    featured_photo_keys: string[];
    featured_badges:     string[];
  };
  profile: {
    kyc_status:           string;
    max_radius_km:        number;
    availability_matrix:  Record<string, { start: string; end: string }[]> | null;
    profile_completeness: number;
  };
  services: PublicService[];
  reviews:  PublicReview[];
}

export const providersApi = {
  getProfile: (userId: string) =>
    api.get<PublicProviderProfile>(`/providers/${userId}`),
};
