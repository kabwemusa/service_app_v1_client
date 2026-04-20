import { api } from './client';

export interface SearchResult {
  id:          string;
  provider_id: string;
  category: {
    id:   number;
    name: string;
  };
  title:       string;
  description: string | null;
  base_price:  number;
  latitude:    number;
  longitude:   number;
  distance_km: number;
  provider: {
    id:              string;
    r_raw:           number;
    r_bayes:         number;
    v_reviews:       number;
    completion_rate: number;
    trust_tier:      number;
    trust_score:     number;
  };
  sort_score:     number;
  has_promo_slot: boolean;
}

export interface SearchParams {
  query?:       string;
  lat:          number;
  lng:          number;
  radius_km?:   number;
  category_id?: number;
  page?:        number;
}

export interface PaginatedSearchResults {
  data:          SearchResult[];
  current_page:  number;
  last_page:     number;
  per_page:      number;
  total:         number;
}

export const searchApi = {
  search: (params: SearchParams) =>
    api.get<PaginatedSearchResults>('/search', { params }),
};
