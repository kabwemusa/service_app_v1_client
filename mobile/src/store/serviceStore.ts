import { create } from 'zustand';
import { ApiError } from '../api/errors';
import { PaginatedServices, Service, ServicePayload, servicesApi } from '../api/services';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

interface ServiceState {
  // Public browse
  services:    Service[];
  page:        number;
  lastPage:    number;
  // Provider's own listings
  myServices:  Service[];
  myPage:      number;
  myLastPage:  number;

  loading:    boolean;
  error:      ApiError | null;

  fetchServices:    (categoryId?: number, reset?: boolean) => Promise<void>;
  fetchMyServices:  (reset?: boolean) => Promise<void>;
  createService:    (payload: ServicePayload) => Promise<Service>;
  updateService:    (id: string, payload: Partial<ServicePayload>) => Promise<Service>;
  deleteService:    (id: string) => Promise<void>;
  /** Optimistic local merge — used for the list's pause/activate toggle. */
  patchService:     (id: string, patch: Partial<Service>) => void;
  clearError:       () => void;
  reset:            () => void;
}

export const useServiceStore = create<ServiceState>((set, get) => ({
  services:   [],
  page:       1,
  lastPage:   1,
  myServices: [],
  myPage:     1,
  myLastPage: 1,
  loading:    false,
  error:      null,

  patchService: (id, patch) => set((s) => ({
    myServices: s.myServices.map((sv) => (sv.id === id ? { ...sv, ...patch } : sv)),
  })),

  clearError: () => set({ error: null }),
  reset: () => set({
    services:   [],
    page:       1,
    lastPage:   1,
    myServices: [],
    myPage:     1,
    myLastPage: 1,
    loading:    false,
    error:      null,
  }),

  fetchServices: async (categoryId, reset = false) => {
    set({ loading: true, error: null });
    try {
      const params: Record<string, any> = {};
      if (categoryId) params.category_id = categoryId;

      const result: PaginatedServices = await servicesApi.list(params);

      set((s) => ({
        services:  reset ? result.data : [...s.services, ...result.data],
        page:      result.current_page,
        lastPage:  result.last_page,
      }));
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  fetchMyServices: async (reset = false) => {
    set({ loading: true, error: null });
    try {
      const result: PaginatedServices = await servicesApi.mine();
      set((s) => ({
        myServices: reset ? result.data : [...s.myServices, ...result.data],
        myPage:     result.current_page,
        myLastPage: result.last_page,
      }));
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  createService: async (payload) => {
    set({ loading: true, error: null });
    try {
      const created = await servicesApi.create(payload);
      set((s) => ({ myServices: [created, ...s.myServices] }));
      return created;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  updateService: async (id, payload) => {
    set({ loading: true, error: null });
    try {
      const updated = await servicesApi.update(id, payload);
      set((s) => ({
        myServices: s.myServices.map((sv) => (sv.id === id ? updated : sv)),
      }));
      return updated;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  deleteService: async (id) => {
    set({ loading: true, error: null });
    try {
      await servicesApi.remove(id);
      set((s) => ({ myServices: s.myServices.filter((sv) => sv.id !== id) }));
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ loading: false });
    }
  },
}));
