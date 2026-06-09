import { create } from 'zustand';

// ── Types ────────────────────────────────────────────────────────────────────

export type AvailabilityOption = 'any' | 'today' | 'week' | 'date';
export type SortOption = 'recommended' | 'top_rated' | 'price_asc' | 'fastest' | 'nearest';

export interface FilterState {
  maxBudget:        number | null;   // null = no limit (slider at 1000)
  availability:     AvailabilityOption;
  availabilityDate: string | null;   // ISO date string, used when availability === 'date'
  verifiedId:       boolean;
  topRated:         boolean;
  minTier:          0 | 2 | 3 | 4;  // 0 = any; matches TrustTier enum values
  languages:        string[];        // 'en' | 'ny' | 'bem' | 'ton'
}

export const DEFAULT_FILTERS: FilterState = {
  maxBudget:        null,
  availability:     'any',
  availabilityDate: null,
  verifiedId:       false,
  topRated:         false,
  minTier:          0,
  languages:        [],
};

export const DEFAULT_SORT: SortOption = 'recommended';

// ── Active count ─────────────────────────────────────────────────────────────

export function countActiveFilters(f: FilterState): number {
  let n = 0;
  if (f.maxBudget !== null)      n++;
  if (f.availability !== 'any')  n++;
  if (f.verifiedId)              n++;
  if (f.topRated)                n++;
  if (f.minTier !== 0)           n++;
  if (f.languages.length > 0)   n++;
  return n;
}

// ── Store ────────────────────────────────────────────────────────────────────
// State is per-category, keyed by categoryId.toString() or 'all'.
// Persists for the session; cleared on explicit reset only.

interface BrowseState {
  filters: Record<string, FilterState>;
  sorts:   Record<string, SortOption>;

  getFilters:   (key: string) => FilterState;
  getSort:      (key: string) => SortOption;
  setFilter:    (key: string, patch: Partial<FilterState>) => void;
  setSort:      (key: string, sort: SortOption) => void;
  resetFilters: (key: string) => void;
  activeCount:  (key: string) => number;
}

export const useBrowseStore = create<BrowseState>((set, get) => ({
  filters: {},
  sorts:   {},

  getFilters: (key) => get().filters[key] ?? { ...DEFAULT_FILTERS },
  getSort:    (key) => get().sorts[key]   ?? DEFAULT_SORT,

  setFilter: (key, patch) =>
    set((s) => ({
      filters: {
        ...s.filters,
        [key]: { ...(s.filters[key] ?? DEFAULT_FILTERS), ...patch },
      },
    })),

  setSort: (key, sort) =>
    set((s) => ({ sorts: { ...s.sorts, [key]: sort } })),

  resetFilters: (key) =>
    set((s) => ({
      filters: { ...s.filters, [key]: { ...DEFAULT_FILTERS } },
    })),

  activeCount: (key) => countActiveFilters(get().filters[key] ?? DEFAULT_FILTERS),
}));
