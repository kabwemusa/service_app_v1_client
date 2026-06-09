import { create } from 'zustand';
import { ApiError } from '../api/errors';
import {
  PaginatedSearchResults,
  ResolvedCategory,
  SearchParams,
  SearchResult,
  searchApi,
} from '../api/search';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

interface SearchState {
  results:           SearchResult[];
  page:              number;
  lastPage:          number;
  total:             number;
  loading:           boolean;
  error:             ApiError | null;
  resolvedCategory:  ResolvedCategory | null;
  lastParams:        SearchParams | null;

  search:     (params: SearchParams, reset?: boolean) => Promise<void>;
  loadMore:   () => Promise<void>;
  clearError: () => void;
  reset:      () => void;
}

const initialState = {
  results:          [],
  page:             1,
  lastPage:         1,
  total:            0,
  loading:          false,
  error:            null,
  resolvedCategory: null,
  lastParams:       null,
};

export const useSearchStore = create<SearchState>((set, get) => ({
  ...initialState,

  clearError: () => set({ error: null }),

  reset: () => set(initialState),

  search: async (params, reset = true) => {
    set({ loading: true, error: null });
    if (reset) {
      set({ results: [], page: 1, lastPage: 1, total: 0, lastParams: params });
    }
    try {
      const result: PaginatedSearchResults = await searchApi.search(params);
      set((s) => ({
        results:          reset ? result.data : [...s.results, ...result.data],
        page:             result.current_page,
        lastPage:         result.last_page,
        total:            result.total,
        resolvedCategory: reset ? (result.resolved_category ?? null) : s.resolvedCategory,
      }));
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  loadMore: async () => {
    const { page, lastPage, loading, lastParams } = get();
    if (loading || page >= lastPage || !lastParams) return;

    const nextParams = { ...lastParams, page: page + 1 };
    set({ lastParams: nextParams });
    await get().search(nextParams, false);
  },
}));
