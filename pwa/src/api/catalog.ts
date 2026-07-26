import { api } from './client';

/** Resolved category-driven pricing-model guidance (config fallbacks applied server-side). */
export interface CategoryPricingGuidance {
  default_model:    string;
  recommended:      string[];
  rationale:        string;
  mismatch_warning: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  synonyms?: string[];
  icon?: string | null;
  parent_id?: number | null;
  risk_tier: number | null;
  pricing_guidance?: CategoryPricingGuidance;
  children?: Category[];
}

/** User-facing labels/descriptions for a pricing model (from GET /pricing-models). */
export interface PricingModelMeta {
  value:       string;
  label:       string;
  description: string;
  rationale:   string;
}

/** Find a category anywhere in the hierarchical tree by id. */
export function findCategoryById(tree: Category[], id: number | null | undefined): Category | null {
  if (id == null) return null;
  for (const node of tree) {
    if (node.id === id) return node;
    const hit = node.children?.length ? findCategoryById(node.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

export interface ServiceCard {
  id: string;
  title: string;
  description?: string;
  // Remote (online) services → show "Online" instead of an area/distance.
  delivery_type?: 'IN_PERSON' | 'REMOTE';
  is_remote?: boolean;
  location_label?: string | null;
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

/** A category flattened for search — keeps its parent name for grouping. */
export interface FlatCategory {
  id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  synonyms: string[];
}

/** Flatten the hierarchical taxonomy (parent → child) into a searchable list. */
export function flattenTaxonomy(tree: Category[], parentName: string | null = null): FlatCategory[] {
  const out: FlatCategory[] = [];
  for (const node of tree) {
    out.push({
      id: node.id,
      name: node.name,
      parent_id: node.parent_id ?? null,
      parent_name: parentName,
      synonyms: node.synonyms ?? [],
    });
    if (node.children?.length) out.push(...flattenTaxonomy(node.children, node.name));
  }
  return out;
}

/** Case-insensitive match on name + synonyms (+ parent name), for type-ahead. */
export function matchesQuery(cat: FlatCategory, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  if (cat.name.toLowerCase().includes(needle)) return true;
  if (cat.parent_name?.toLowerCase().includes(needle)) return true;
  return cat.synonyms.some((s) => s.toLowerCase().includes(needle));
}

// Public, zero-wall browse — no auth required (customer browse-first).
export const catalogApi = {
  // The ONE shared taxonomy the picker searches (hierarchical, with synonyms).
  categories: () => api.get<Category[]>('/categories'),
  // Most-used categories for the quick-tap chips (server-ranked, config-limited).
  popularCategories: () => api.get<Category[]>('/categories/popular'),
  // The ONE source of user-facing pricing-model labels/descriptions.
  pricingModels: () => api.get<{ models: PricingModelMeta[]; default_model: string }>('/pricing-models'),
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
