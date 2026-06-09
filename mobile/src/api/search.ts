import { api } from './client';
import { PricingModel } from './services';

export interface SearchResult {
  id:          string;
  provider_id: string;
  category: {
    id:   number;
    name: string;
    icon: string | null;
  };
  title:         string;
  description:   string | null;
  pricing_model: PricingModel;
  base_price:    number | null;
  latitude:      number;
  longitude:     number;
  distance_km:   number | null;
  // trust_score (raw 0–1) is never exposed client-side — use trust_tier badge (v3.1 §7)
  has_promo_slot:      boolean;
  completed_job_count: number;
  provider: {
    id:                     string;
    display_name:           string;
    r_raw:                  number;
    r_bayes:                number;
    v_reviews:              number;
    completion_rate:        number;
    trust_tier:             number;
    response_time_p50_mins: number | null;
  };
  sort_score: number;
}

/** Slim category shape returned inside search/suggest responses. */
export interface ResolvedCategory {
  id:       number;
  name:     string;
  slug:     string;
  icon:     string | null;
  children: Array<{ id: number; name: string; slug: string; icon: string | null }>;
}

/** One row in the autocomplete suggestion list. */
export type SuggestionType = 'category' | 'service' | 'provider';

export interface Suggestion {
  type:        SuggestionType;
  id:          string | number;
  label:       string;
  subtitle:    string;
  /** Ionicons name — present for category suggestions */
  icon?:       string | null;
  /** Provider avatar initials — present for provider suggestions */
  initials?:   string;
  /** Which category this service belongs to — present for service suggestions */
  category?:   string;
  /** [start, end] byte offsets of the matched substring in `label` */
  match_span?: [number, number] | null;
}

export interface SuggestResult {
  suggestions:        Suggestion[];
  resolved_category:  ResolvedCategory | null;
}

export interface SearchParams {
  query?:       string;
  // Resolved delivery location L — never a user-typed radius (v3.1 §4.1/§4.4).
  lat?:         number;
  lng?:         number;
  category_id?: number;
  page?:        number;
  // Browse filters (v3.1 §6 Filters sheet)
  max_price?:         number;
  availability?:      'any' | 'today' | 'week' | 'date';
  availability_date?: string;
  verified_id?:       boolean;
  top_rated?:         boolean;
  min_tier?:          number;
  languages?:         string;
  sort?:              'recommended' | 'top_rated' | 'price_asc' | 'fastest' | 'nearest';
}

export interface PaginatedSearchResults {
  data:               SearchResult[];
  current_page:       number;
  last_page:          number;
  per_page:           number;
  total:              number;
  resolved_category:  ResolvedCategory | null;
}

export const searchApi = {
  search: (params: SearchParams) =>
    api.get<PaginatedSearchResults>('/search', { params }),

  suggest: (q: string, lat?: number, lng?: number) =>
    api.get<SuggestResult>('/search/suggest', {
      params: { q, ...(lat != null && lng != null ? { lat, lng } : {}) },
    }),
};
