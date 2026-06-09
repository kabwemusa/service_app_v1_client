import { AppState, AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { categoriesApi, Category } from '../api/categories';
import { ApiError } from '../api/errors';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

interface CategoryState {
  categories:      Category[];
  loading:         boolean;
  error:           ApiError | null;
  lastFetchedAt:   number | null;
  fetchCategories: (force?: boolean) => Promise<void>;
  clearError:      () => void;
}

const REVALIDATE_MS = 5 * 60 * 1000; // 5 min — revalidate on app focus if stale

export const useCategoryStore = create<CategoryState>((set, get) => {
  // Revalidate when the app returns to the foreground
  AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state !== 'active') return;
    const { lastFetchedAt, loading } = get();
    if (loading) return;
    const stale = lastFetchedAt === null || Date.now() - lastFetchedAt > REVALIDATE_MS;
    if (stale) get().fetchCategories();
  });

  return {
    categories:    [],
    loading:       false,
    error:         null,
    lastFetchedAt: null,

    clearError: () => set({ error: null }),

    fetchCategories: async (force = false) => {
      const { loading, lastFetchedAt } = get();
      if (loading) return;
      const fresh = lastFetchedAt !== null && Date.now() - lastFetchedAt < REVALIDATE_MS;
      if (!force && fresh) return;

      set({ loading: true, error: null });
      try {
        const data = await categoriesApi.list();
        set({ categories: data, lastFetchedAt: Date.now() });
      } catch (e) {
        set({ error: toApiError(e) });
      } finally {
        set({ loading: false });
      }
    },
  };
});
