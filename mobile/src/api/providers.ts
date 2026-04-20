import { api } from './client';

export interface PublicService {
  id:          string;
  title:       string;
  description: string | null;
  base_price:  number;
  category:    { id: number; name: string };
  latitude:    number | null;
  longitude:   number | null;
}

export interface PublicReview {
  id:          string;
  rating:      number;
  comment:     string | null;
  reviewer:    { id: string; name: string };
  created_at:  string;
}

export interface PublicProviderProfile {
  id:              string;
  display_name:    string | null;
  bio:             string | null;
  r_raw:           number;
  v_reviews:       number;
  completion_rate: number;
  last_active_at:  string | null;
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
