import { api } from './client';

/** Resolved, category-driven pricing-model guidance (config fallbacks applied server-side). */
export interface CategoryPricingGuidance {
  default_model:    string;   // pre-selected model for a new service here
  recommended:      string[]; // models that do NOT trigger the mismatch nudge
  rationale:        string;   // "why this pays fairly" line
  mismatch_warning: string;   // benefit-framed nudge for an ill-suited pick
}

export interface Category {
  id:              number;
  parent_id:       number | null;
  name:            string;
  slug:            string;
  synonyms:        string[];
  icon:            string | null;   // Ionicons name, e.g. 'sparkles-outline'
  icon_url:        string | null;   // full URL when set by admin
  is_active:       boolean;
  display_order:   number;
  commission_band: string;
  /** Category-driven pricing guidance for the service editor. */
  pricing_guidance?: CategoryPricingGuidance;
  children:        Category[];
}

/** User-facing labels/descriptions for a pricing model (from GET /pricing-models). */
export interface PricingModelMeta {
  value:       string;
  label:       string;
  description: string;
  rationale:   string;
}

export const categoriesApi = {
  // The ONE shared taxonomy the picker searches (hierarchical, with synonyms).
  list:    () => api.get<Category[]>('/categories'),
  // Most-used categories for the quick-tap chips (server-ranked, config-limited).
  popular: () => api.get<Category[]>('/categories/popular'),
  // The ONE source of user-facing pricing-model labels/descriptions.
  pricingModels: () => api.get<{ models: PricingModelMeta[]; default_model: string }>('/pricing-models'),
};

/** Find a category anywhere in the hierarchical tree by id. */
export function findCategoryById(tree: Category[], id: number | undefined): Category | null {
  if (id == null) return null;
  for (const node of tree) {
    if (node.id === id) return node;
    const hit = node.children?.length ? findCategoryById(node.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

/** A category flattened for search: keeps its parent name for grouping/labels. */
export interface FlatCategory {
  id:          number;
  name:        string;
  parent_id:   number | null;
  parent_name: string | null;
  synonyms:    string[];
  icon:        string | null;
}

/** Flatten the hierarchical taxonomy (parent → child) into a searchable list. */
export function flattenTaxonomy(tree: Category[]): FlatCategory[] {
  const out: FlatCategory[] = [];
  const walk = (nodes: Category[], parentName: string | null) => {
    for (const node of nodes) {
      out.push({
        id: node.id,
        name: node.name,
        parent_id: node.parent_id,
        parent_name: parentName,
        synonyms: node.synonyms ?? [],
        icon: node.icon,
      });
      if (node.children?.length) walk(node.children, node.name);
    }
  };
  walk(tree, null);
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
