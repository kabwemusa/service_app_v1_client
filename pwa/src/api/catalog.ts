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
  pricing_model: string;
  photos?: { id: number; url: string }[];
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
