import { api } from './client';

export interface PublicService {
  id:            string;
  title:         string;
  description:   string | null;
  pricing_model: 'FIXED' | 'HOURLY' | 'QUOTE';
  base_price:    number | null;
  category:      { id: number; name: string };
  latitude:      number | null;
  longitude:     number | null;
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
  r_raw:                number;
  v_reviews:            number;
  completion_rate:      number;
  last_active_at:       string | null;
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
