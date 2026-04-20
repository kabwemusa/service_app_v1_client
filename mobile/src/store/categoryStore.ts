import { create } from 'zustand';
import { categoriesApi, Category } from '../api/categories';
import { ApiError } from '../api/errors';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

interface CategoryState {
  categories: Category[];
  loading:    boolean;
  error:      ApiError | null;
  fetchCategories: () => Promise<void>;
  clearError:      () => void;
}

export const useCategoryStore = create<CategoryState>((set) => ({
  categories: [],
  loading:    false,
  error:      null,

  clearError: () => set({ error: null }),

  fetchCategories: async () => {
    set({ loading: true, error: null });
    try {
      const data = await categoriesApi.list();
      set({ categories: data });
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },
}));
