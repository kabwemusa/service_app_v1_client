import { api } from './client';

export interface PublicService {
  id:            string;
  title:         string;
  description:   string | null;
  pricing_model: 'OUTCOME_FIXED' | 'PROVIDER_SCOPE' | 'HOURLY_CAPPED' | 'QUOTE_DEPOSIT';
  base_price:    number | null;
  category:      { id: number; name: string };
  // Delivery: IN_PERSON | REMOTE (online). location_label = "Online" when remote.
  delivery_type:  'IN_PERSON' | 'REMOTE';
  is_remote:      boolean;
  location_label: string | null;
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
    availability_matrix:  Record<string, { start: string; end: string }[]> | null;
    profile_completeness: number;
  };
  services: PublicService[];
  reviews:  PublicReview[];
}

// ── Provider-wide reviews (§7.1) ────────────────────────────────────────────

export type ReviewSort = 'recent' | 'highest' | 'lowest';

/** One review on the All-Reviews feed. Always from a COMPLETED booking (§10.4). */
export interface ProviderReview {
  id:         string;
  rating:     number;
  comment:    string | null;
  created_at: string;
  /** Masked — first name + last initial only, never the full legal name. */
  reviewer:   { name: string };
  /** The booking→service this review was left for (null if the service is gone). */
  service:    { id: string; title: string } | null;
  /** Reviews exist only for completed bookings — an anti-fake trust marker. */
  verified:   boolean;
}

export interface ProviderReviewsSummary {
  /** Bayesian header score (§7.1) — null until the first review lands. */
  rating:       number | null;
  count:        number;
  /** Full 5→1 star counts across ALL reviews (not the current page/filter). */
  distribution: Record<'5' | '4' | '3' | '2' | '1', number>;
}

export interface ProviderReviewsPage {
  summary:      ProviderReviewsSummary;
  data:         ProviderReview[];
  current_page: number;
  last_page:    number;
  per_page:     number;
  total:        number;
}

export const providersApi = {
  getProfile: (userId: string) =>
    api.get<PublicProviderProfile>(`/providers/${userId}`),

  getReviews: (
    userId: string,
    params: { sort?: ReviewSort; rating?: number; page?: number } = {},
  ) => api.get<ProviderReviewsPage>(`/providers/${userId}/reviews`, { params }),
};
