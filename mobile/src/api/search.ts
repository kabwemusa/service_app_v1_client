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
  payment_mode:  'DIRECT' | 'ESCROW';
  // Delivery: IN_PERSON (geo applies) | REMOTE (online, nationwide).
  delivery_type:  'IN_PERSON' | 'REMOTE';
  is_remote:      boolean;
  // Provider-set service location — "Online" when remote, else base-location label.
  location_label: string | null;
  latitude:      number;
  longitude:     number;
  distance_km:   number | null;
  // trust_score (raw 0–1) is never exposed client-side — use trust_tier badge (v3.1 §7)
  has_promo_slot:      boolean;
  /**
   * v3.2 §1.5 — structural placement: 'promoted' rows occupy the reserved
   * positions 1/4 and MUST carry the "Promoted" label; never inferred from
   * has_promo_slot (owning a slot ≠ occupying a promoted position).
   */
  placement:           'organic' | 'promoted';
  completed_job_count: number;
  /**
   * Growth & Promotions badge (server-resolved for the current user) or null.
   * Cosmetic only — a promo badges a service, it does NOT re-rank it (that is
   * the separate `placement` field).
   */
  promo: { label: string; campaign_id: string } | null;
  provider: {
    id:                     string;
    display_name:           string;
    /** Public profile photo — null until the provider uploads one. */
    avatar_url:             string | null;
    r_raw:                  number;
    r_bayes:                number;
    v_reviews:              number;
    /** null = provider has no booking history yet — render "–", not 0%. */
    completion_rate:        number | null;
    trust_tier:             number;
    response_time_p50_mins: number | null;
    base_location_label:   string | null;
  };
  photo_urls: string[];
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
  /** Province label of the active delivery location — enables promoted-slot
   *  matching (v3.2 §1.5: inventory is auctioned per category × region). */
  region?:      string;
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
  /** True when no providers cover the delivery location and results are
   *  national-quality-ranked fallbacks instead. */
  fallback:           boolean;
}

export const searchApi = {
  search: (params: SearchParams) =>
    api.get<PaginatedSearchResults>('/search', { params }),

  suggest: (q: string, lat?: number, lng?: number) =>
    api.get<SuggestResult>('/search/suggest', {
      params: { q, ...(lat != null && lng != null ? { lat, lng } : {}) },
    }),
};

// ── Natural-language matcher ───────────────────────────────────────────────────
// POST /match runs the full layered pipeline (exact → synonym → semantic → LLM).
// Type-ahead uses the cheap `suggest` above and NEVER calls the LLM; the LLM only
// runs here, on submit, for genuinely ambiguous queries.

export type MatchStatus =
  | 'matched'            // real ranked services returned in `data`
  | 'matched_no_supply'  // real match, but no local providers cover it yet
  | 'clarify'            // ambiguous — ask with `candidates` (2–3 real options)
  | 'empty';             // nothing matches — honest empty + `closest_categories`

export interface MatchCandidate {
  ref:         string;
  type:        'category' | 'service';
  id:          string | number;
  label:       string;
  subtitle:    string;
  category_id: number | null;
}

export interface MatchResponse {
  status:             MatchStatus;
  layer:              string | null;
  confidence:         number;
  used_llm:           boolean;
  /** Reference this when reporting the outcome (booked/refined) for tuning. */
  log_id:             string | null;
  query:              string;
  resolved_category:  { id: number } | null;
  candidates:         MatchCandidate[];
  closest_categories: { id: number; name: string }[];
  data:               SearchResult[];
  total:              number;
  fallback:           boolean;
  impression_id?:     string | null;
}

export interface MatchParams {
  query:  string;
  lat?:   number;
  lng?:   number;
  region?: string;
  page?:  number;
}

export const matchApi = {
  match: (params: MatchParams) => api.post<MatchResponse>('/match', params),

  /** Feed the tuning dataset (privacy-safe: no PII). Best-effort, fire-and-forget. */
  recordOutcome: (
    logId: string,
    outcome: 'booked' | 'refined' | 'abandoned',
    bookedServiceId?: string,
  ) =>
    api
      .post(`/match/${logId}/outcome`, { outcome, booked_service_id: bookedServiceId })
      .catch(() => {}),
};
