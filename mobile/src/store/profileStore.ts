import { create } from 'zustand';
import { ApiError } from '../api/errors';
import { ProfilePayload, providerProfileApi, ProviderProfile, ProviderDashboard, ProviderEarnings } from '../api/providerProfile';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

interface ProfileState {
  profile:    ProviderProfile | null;
  dashboard:  ProviderDashboard | null;
  earnings:   ProviderEarnings | null;
  loading:    boolean;
  error:      ApiError | null;
  fetchProfile:   () => Promise<void>;
  fetchDashboard: () => Promise<void>;
  fetchEarnings:  () => Promise<void>;
  upsertProfile:  (payload: ProfilePayload) => Promise<void>;
  uploadCoverPhoto:     (uri: string) => Promise<void>;
  uploadKyc:            (uri: string) => Promise<void>;
  uploadPortfolioImage: (uri: string) => Promise<void>;
  deletePortfolioImage: (path: string) => Promise<void>;
  clearError:    () => void;
  reset:         () => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile:   null,
  dashboard: null,
  earnings:  null,
  loading: false,
  error:   null,

  clearError: () => set({ error: null }),
  reset:      () => set({ profile: null, dashboard: null, earnings: null, loading: false, error: null }),

  fetchProfile: async () => {
    set({ loading: true, error: null });
    try {
      const profile = await providerProfileApi.get();
      set({ profile });
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  fetchDashboard: async () => {
    set({ loading: true, error: null });
    try {
      const dashboard = await providerProfileApi.dashboard();
      set({ dashboard });
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  fetchEarnings: async () => {
    set({ loading: true, error: null });
    try {
      const earnings = await providerProfileApi.earnings();
      set({ earnings });
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  upsertProfile: async (payload) => {
    set({ loading: true, error: null });
    try {
      const profile = await providerProfileApi.upsert(payload);
      set({ profile });
    } catch (e) {
      set({ error: toApiError(e) });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  uploadCoverPhoto: async (uri) => {
    set({ error: null });
    try {
      const profile = await providerProfileApi.uploadCoverPhoto(uri);
      set({ profile });
    } catch (e) {
      set({ error: toApiError(e) });
      throw e;
    }
  },

  uploadKyc: async (uri) => {
    set({ loading: true, error: null });
    try {
      const profile = await providerProfileApi.uploadKyc(uri);
      set({ profile });
    } catch (e) {
      set({ error: toApiError(e) });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  uploadPortfolioImage: async (uri) => {
    set({ error: null });
    try {
      const profile = await providerProfileApi.uploadPortfolioImage(uri);
      set({ profile });
    } catch (e) {
      set({ error: toApiError(e) });
      throw e;
    }
  },

  deletePortfolioImage: async (path) => {
    set({ error: null });
    try {
      const profile = await providerProfileApi.deletePortfolioImage(path);
      set({ profile });
    } catch (e) {
      set({ error: toApiError(e) });
      throw e;
    }
  },
}));
