import { api } from './client';

// Thin mirror of mobile/src/api/search.ts — the SAME ranked discovery engine.
// The PWA renders whatever order the backend returns; it never sorts, filters,
// or scores providers itself. The raw trust_score is never exposed — only the
// trust_tier badge and verified facts.

export type PricingModel = 'OUTCOME_FIXED' | 'PROVIDER_SCOPE' | 'HOURLY_CAPPED' | 'QUOTE_DEPOSIT';

export interface SearchResult {
  id:          string;
  provider_id: string;
  category: { id: number; name: string; icon: string | null };
  title:         string;
  description:   string | null;
  pricing_model: PricingModel;
  // Remote (online) services → show "Online" instead of an area/distance.
  delivery_type: 'IN_PERSON' | 'REMOTE';
  is_remote:     boolean;
  base_price:    number | null;
  payment_mode:  'DIRECT' | 'ESCROW';
  latitude:      number;
  longitude:     number;
  distance_km:   number | null;
  has_promo_slot: boolean;
  /** Structural placement — 'promoted' rows carry the "Promoted" label. */
  placement:           'organic' | 'promoted';
  completed_job_count: number;
  provider: {
    id:                     string;
    display_name:           string;
    r_raw:                  number;
    r_bayes:                number;
    v_reviews:              number;
    completion_rate:        number | null;
    trust_tier:             number;
    response_time_p50_mins: number | null;
    base_location_label:    string | null;
  };
  photo_urls: string[];
  sort_score: number;
}

export interface ResolvedCategory {
  id:       number;
  name:     string;
  slug:     string;
  icon:     string | null;
  children: Array<{ id: number; name: string; slug: string; icon: string | null }>;
}

export interface SearchParams {
  query?:       string;
  /** Resolved delivery location L — never a user-typed radius. */
  lat?:         number;
  lng?:         number;
  category_id?: number;
  region?:      string;
  page?:        number;
  sort?:        'recommended' | 'top_rated' | 'price_asc' | 'fastest' | 'nearest';
}

export interface PaginatedSearchResults {
  data:              SearchResult[];
  current_page:      number;
  last_page:         number;
  per_page:          number;
  total:             number;
  resolved_category: ResolvedCategory | null;
  /** True when no providers cover L and results are national fallbacks. */
  fallback:          boolean;
}

function qs(params: Record<string, unknown>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : '';
}

export const searchApi = {
  search: (params: SearchParams) =>
    api.get<PaginatedSearchResults>(`/search${qs(params as Record<string, unknown>)}`),
};
