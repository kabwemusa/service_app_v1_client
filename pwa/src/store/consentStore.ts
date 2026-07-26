import { create } from 'zustand';
import { ConsentStatus, legalApi } from '../api/legal';
import type { ApiError } from '../api/client';

/**
 * PWA consent state — mirrors the mobile consentStore so the gate logic and audit
 * are identical across surfaces. `ConsentGateHost` (app root) blocks the app while
 * `status.needs_consent` is true for a signed-in user.
 */
type ConsentPhase = 'unknown' | 'ready' | 'declined';

interface ConsentState {
  phase: ConsentPhase;
  status: ConsentStatus | null;
  loading: boolean;
  submitting: boolean;
  error: ApiError | null;

  refresh: () => Promise<void>;
  accept: (opts: { marketing: boolean; analytics: boolean }) => Promise<boolean>;
  decline: () => Promise<void>;
  withdraw: (scope: 'marketing' | 'analytics' | 'CORE') => Promise<boolean>;
  reset: () => void;
  clearDeclined: () => void;
}

export const useConsentStore = create<ConsentState>((set) => ({
  phase: 'unknown',
  status: null,
  loading: false,
  submitting: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const status = await legalApi.status();
      set({ status, phase: 'ready', loading: false });
    } catch (e) {
      set({ error: e as ApiError, loading: false });
    }
  },

  accept: async ({ marketing, analytics }) => {
    set({ submitting: true, error: null });
    try {
      const res = await legalApi.accept({ marketing, analytics });
      set({ status: res.status, phase: 'ready', submitting: false });
      return true;
    } catch (e) {
      set({ error: e as ApiError, submitting: false });
      return false;
    }
  },

  decline: async () => {
    set({ submitting: true, error: null });
    try {
      await legalApi.decline();
    } catch {
      // best-effort; we block regardless
    } finally {
      set({ submitting: false, phase: 'declined' });
    }
  },

  withdraw: async (scope) => {
    set({ submitting: true, error: null });
    try {
      const res = await legalApi.withdraw(scope);
      set({ status: res.status, submitting: false });
      return true;
    } catch (e) {
      set({ error: e as ApiError, submitting: false });
      return false;
    }
  },

  reset: () => set({ phase: 'unknown', status: null, error: null, loading: false, submitting: false }),
  clearDeclined: () => set({ phase: 'unknown' }),
}));
