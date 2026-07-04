import { create } from 'zustand';
import { ApiError } from '../api/errors';
import { verificationApi, VerificationStatus } from '../api/verification';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

interface VerificationState {
  status:     VerificationStatus | null;
  loading:    boolean;
  submitting: boolean;
  error:      ApiError | null;

  fetchStatus:            () => Promise<void>;
  submitPortfolio:        (uris: string[]) => Promise<boolean>;
  submitPoliceClearance:  (uri: string, certNumber: string, issuedOn: string, expiresOn?: string | null) => Promise<boolean>;
  clearError:             () => void;
  reset:                  () => void;
}

export const useVerificationStore = create<VerificationState>((set) => ({
  status:     null,
  loading:    false,
  submitting: false,
  error:      null,

  clearError: () => set({ error: null }),
  reset:      () => set({ status: null, loading: false, submitting: false, error: null }),

  fetchStatus: async () => {
    set({ loading: true, error: null });
    try {
      const status = await verificationApi.status();
      set({ status });
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  submitPortfolio: async (uris) => {
    set({ submitting: true, error: null });
    try {
      // The submission endpoints return the fresh ladder, so we update in place.
      const status = await verificationApi.submitPortfolio(uris);
      set({ status });
      return true;
    } catch (e) {
      set({ error: toApiError(e) });
      return false;
    } finally {
      set({ submitting: false });
    }
  },

  submitPoliceClearance: async (uri, certNumber, issuedOn, expiresOn) => {
    set({ submitting: true, error: null });
    try {
      const status = await verificationApi.submitPoliceClearance(uri, certNumber, issuedOn, expiresOn);
      set({ status });
      return true;
    } catch (e) {
      set({ error: toApiError(e) });
      return false;
    } finally {
      set({ submitting: false });
    }
  },
}));
