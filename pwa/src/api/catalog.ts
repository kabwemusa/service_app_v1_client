import { api } from './client';

export interface Category {
  id: number;
  name: string;
  slug: string;
  risk_tier: number | null;
  children?: Category[];
}

export interface ServiceCard {
  id: string;
  title: string;
  description?: string;
  category?: { id: number; name: string; risk_tier?: number };
  min_price?: number;
  base_price?: number;
  // Outcome-based pricing: OUTCOME_FIXED | PROVIDER_SCOPE | HOURLY_CAPPED | QUOTE_DEPOSIT
  pricing_model: string;
  hourly_rate?: number | null;
  minimum_hours?: number | null;
  cap_hours?: number | null;
  cap_amount?: number | null;
  deposit_percent?: number | null;
  scope_prompts?: string[];
  photos?: { id: number; url: string }[];
}

/** Model-aware price line — pure DISPLAY of backend-provided values. It never
 *  computes an amount (no rate × hours) or invents a default (no `?? 30`); every
 *  number here comes straight from the service the backend returned. */
export function priceLine(s: ServiceCard): string | null {
  if (s.pricing_model === 'PROVIDER_SCOPE') return 'Quoted after your brief';
  if (s.pricing_model === 'QUOTE_DEPOSIT') {
    return s.deposit_percent != null
      ? `Quoted after your brief · ${s.deposit_percent}% deposit`
      : 'Quoted after your brief';
  }
  if (s.pricing_model === 'HOURLY_CAPPED' && s.hourly_rate != null) {
    const min = s.minimum_hours != null ? ` · ${s.minimum_hours}-hr min` : '';
    const cap = s.cap_amount != null ? ` · max K${s.cap_amount}` : '';
    return `K${s.hourly_rate}/hr${min}${cap}`;
  }
  const p = s.min_price ?? s.base_price;
  return p != null ? `K${p}` : null;
}

interface Paginated<T> {
  data: T[];
  current_page: number;
  last_page: number;
  total: number;
}

// Public, zero-wall browse — no auth required (customer browse-first).
export const catalogApi = {
  categories: () => api.get<Category[]>('/categories'),
  services: (params: { category_id?: number; q?: string; sort?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.category_id) qs.set('category_id', String(params.category_id));
    if (params.q) qs.set('q', params.q);
    if (params.sort) qs.set('sort', params.sort);
    const suffix = qs.toString() ? `?${qs}` : '';
    return api.get<Paginated<ServiceCard>>(`/services${suffix}`);
  },
  service: (id: string) => api.get<ServiceCard>(`/services/${id}`),
};
