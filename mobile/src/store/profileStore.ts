import { create } from 'zustand';
import { ApiError } from '../api/errors';
import { ProfilePayload, providerProfileApi, ProviderProfile } from '../api/providerProfile';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

interface ProfileState {
  profile:    ProviderProfile | null;
  loading:    boolean;
  error:      ApiError | null;
  fetchProfile:  () => Promise<void>;
  upsertProfile: (payload: ProfilePayload) => Promise<void>;
  uploadKyc:     (uri: string) => Promise<void>;
  clearError:    () => void;
  reset:         () => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  loading: false,
  error:   null,

  clearError: () => set({ error: null }),
  reset:      () => set({ profile: null, loading: false, error: null }),

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
}));
