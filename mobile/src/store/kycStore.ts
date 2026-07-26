import { create } from 'zustand';
import { DocType, kycApi, KycStatus } from '../api/kyc';
import { ApiError } from '../api/errors';

interface KycState {
  status:   KycStatus | null;
  loading:  boolean;
  error:    ApiError | null;

  fetchStatus:    () => Promise<void>;
  submitTier1:    (legalName: string, nrcNumber: string, selfieUri: string) => Promise<boolean>;
  submitDocument: (docType: DocType, documentUri: string, selfieUri: string, documentBackUri?: string | null) => Promise<boolean>;
  submitAddress:  (documentUri: string) => Promise<boolean>;
  clearError:     () => void;
  reset:          () => void;
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

export const useKycStore = create<KycState>((set) => ({
  status:  null,
  loading: false,
  error:   null,

  clearError: () => set({ error: null }),
  reset:      () => set({ status: null, loading: false, error: null }),

  fetchStatus: async () => {
    set({ loading: true, error: null });
    try {
      const status = await kycApi.getStatus();
      set({ status });
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  submitTier1: async (legalName, nrcNumber, selfieUri) => {
    set({ loading: true, error: null });
    try {
      await kycApi.submitTier1(legalName, nrcNumber, selfieUri);
      // Refresh status so tier bumps to 1
      const status = await kycApi.getStatus();
      set({ status });
      return true;
    } catch (e) {
      set({ error: toApiError(e) });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  submitDocument: async (docType, documentUri, selfieUri, documentBackUri) => {
    set({ loading: true, error: null });
    try {
      await kycApi.submitDocument(docType, documentUri, selfieUri, documentBackUri);
      const status = await kycApi.getStatus();
      set({ status });
      return true;
    } catch (e) {
      set({ error: toApiError(e) });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  submitAddress: async (documentUri) => {
    set({ loading: true, error: null });
    try {
      await kycApi.submitAddress(documentUri);
      const status = await kycApi.getStatus();
      set({ status });
      return true;
    } catch (e) {
      set({ error: toApiError(e) });
      return false;
    } finally {
      set({ loading: false });
    }
  },
}));
