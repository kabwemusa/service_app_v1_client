import { api } from './client';

export interface ServicePhoto {
  id:            number;
  path:          string;   // relative path — use storageUrl(path) to render
  display_order: number;
}

// Outcome-based pricing — customers never input hours; every price parameter
// below is provider-set.
export type PricingModel = 'OUTCOME_FIXED' | 'PROVIDER_SCOPE' | 'HOURLY_CAPPED' | 'QUOTE_DEPOSIT';
export type ServiceStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'HIDDEN';

export interface ServiceAddon {
  id:    number;
  name:  string;
  price: number;
}

// §6.2 — provider card on service detail (v3.1 schema note: avatar_url is the
// PUBLIC profile photo, never the private KYC selfie).
export interface ServiceProvider {
  id:                      string;
  display_name:            string | null;
  bio:                     string | null;
  // Public profile photo — initials fallback when null (never broken-image).
  avatar_url:              string | null;
  cover_image_url:         string | null;
  // v3 §4.1 tier label + verified check
  trust_tier:              number;
  kyc_status:              string | null;
  year_started:            number | null;
  // v3.1 §6.6 — limited to supported codes: en / ny / bem / ton
  languages:               string[];
  certifications:          unknown[];
  base_location_label:     string | null;
  // Decision stats (v3.1 §7)
  response_time_p50_mins:  number | null;
  availability_matrix:     Record<string, { start: string; end: string }[]> | null;
  repeat_client_rate:      number | null;
  // Bayesian rating (v3 §7.1) — trust_score is NEVER exposed to customers
  r_raw:                   number;
  v_reviews:               number;
  /** null = provider has no booking history yet — render "–", not 0%. */
  completion_rate:         number | null;
  // Portfolio: previous-work photos (storage paths — render via storageUrl)
  portfolio_images:        string[];
  // Earned badges (v3 §9.2)
  badges:                  string[];
}

export interface ServiceReview {
  id:         string;
  rating:     number;
  comment:    string | null;
  created_at: string;
  reviewer:   { id: string; name: string };
}

export interface StarDistEntry {
  star:  number;
  count: number;
}

export interface Service {
  id:          string;
  provider_id: string;
  category_id: number;
  category:    { id: number; name: string; icon_url: string | null } | null;
  title:       string;
  description: string | null;
  // Delivery: IN_PERSON (geo applies) | REMOTE (online, nationwide, no geo).
  delivery_type?:  'IN_PERSON' | 'REMOTE';
  is_remote?:      boolean;
  // "Online" for remote services, else the provider's base-location label.
  location_label?: string | null;
  // Outcome-based pricing. base_price is the browse "from" price:
  // outcome price (OUTCOME_FIXED) / spend cap (HOURLY_CAPPED) / null (quote-first).
  pricing_model:           PricingModel;
  base_price:              number | null;
  hourly_rate:             number | null;
  minimum_hours:           number | null;
  cap_hours:               number | null;
  cap_amount:              number | null;
  deposit_percent:         number | null;
  // Structured brief questions the customer answers (quote-first models).
  scope_prompts:           string[];
  // Set by the HOURLY→HOURLY_CAPPED migration until the provider confirms the cap.
  needs_pricing_review:    boolean;
  // Platform payment mode a booking for this service would be created under (drives CTA copy).
  payment_mode:            'DIRECT' | 'ESCROW';
  duration_estimate_mins:  number | null;
  status:                  ServiceStatus;
  is_pinned:               boolean;
  // Completed-booking count — only populated on the provider's own list (listMine).
  bookings_count?:         number | null;
  latitude:    number | null;
  longitude:   number | null;
  distance_km: number | null;
  provider:    ServiceProvider | null;
  inclusions:  string[];
  addons:      ServiceAddon[];
  photos:      ServicePhoto[];
  // Detail-only fields (populated by the show endpoint, empty on list endpoints)
  reviews:           ServiceReview[];
  review_count:      number;
  star_distribution: StarDistEntry[];
  created_at: string;
}

export interface ServicePayload {
  category_id:             number;
  title:                   string;
  description?:            string;
  // Omit to default to IN_PERSON; REMOTE = delivered online (nationwide, no geo).
  delivery_type?:          'IN_PERSON' | 'REMOTE';
  pricing_model:           PricingModel;
  base_price?:             number | null;
  hourly_rate?:            number | null;
  minimum_hours?:          number | null;
  cap_hours?:              number | null;
  deposit_percent?:        number | null;
  scope_prompts?:          string[] | null;
  duration_estimate_mins?: number | null;
  status?:                 ServiceStatus;
  is_pinned?:              boolean;
  // Optional: omit to default to the provider's base location (§4.4).
  latitude?:               number;
  longitude?:              number;
  inclusions?:             string[];
  addons?:                 { name: string; price: number }[];
}

export interface PaginatedServices {
  data:          Service[];
  current_page:  number;
  last_page:     number;
  per_page:      number;
  total:         number;
}

// §6.7 — commission preview shown live as the provider sets a price:
// "At {price}, {category}/{tier} commission is {rate}. You keep ~{net}."
export interface CommissionPreview {
  gross:             number;
  processor_fee:     number;
  commission_base:   number;
  tier_rate:         number;
  subscription_disc: number;
  effective_rate:    number;
  commission:        number;
  vat:               number;
  net_to_provider:   number;
  tier:              number;
}

export const servicesApi = {
  list:   (params?: { category_id?: number }) =>
    api.get<PaginatedServices>('/services', { params }),

  show:   (id: string) =>
    api.get<Service>(`/services/${id}`),

  // Provider-only
  mine:   () =>
    api.get<PaginatedServices>('/provider/services'),

  create: (payload: ServicePayload) =>
    api.post<Service>('/provider/services', payload),

  update: (id: string, payload: Partial<ServicePayload>) =>
    api.put<Service>(`/provider/services/${id}`, payload),

  remove: (id: string) =>
    api.delete<null>(`/provider/services/${id}`),

  uploadPhoto: (id: string, formData: FormData) =>
    api.upload<ServicePhoto>(`/provider/services/${id}/photos`, formData),

  deletePhoto: (serviceId: string, photoId: number) =>
    api.delete<null>(`/provider/services/${serviceId}/photos/${photoId}`),

  // Persist gallery order — index 0 is the cover (§5.4).
  reorderPhotos: (serviceId: string, photoIds: number[]) =>
    api.put<ServicePhoto[]>(`/provider/services/${serviceId}/photos/order`, { photo_ids: photoIds }),

  commissionPreview: (categoryId: number, price: number) =>
    api.get<CommissionPreview>('/provider/services/commission-preview', {
      params: { category_id: categoryId, price },
    }),
};
