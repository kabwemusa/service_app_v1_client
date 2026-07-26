import { create } from 'zustand';
import { ApiError } from '../api/errors';
import { ConsentStatus, legalApi } from '../api/legal';

/**
 * Drives the post-signup consent GATE and the ongoing consent state.
 *
 * The gate (App.tsx) blocks the app while `status.needs_consent` is true — the
 * user must accept the required agreements (or decline, which ends the session).
 * Optional processing (marketing / non-essential analytics) is UNBUNDLED and
 * defaults OFF; the gate never pre-ticks it. Withdrawal + data-subject-rights
 * requests are exposed later from Profile → Privacy & consent.
 */
type ConsentPhase = 'unknown' | 'ready' | 'declined';

interface ConsentState {
  phase: ConsentPhase;
  status: ConsentStatus | null;
  loading: boolean;
  submitting: boolean;
  error: ApiError | null;

  /** Fetch consent standing after auth. */
  refresh: () => Promise<void>;
  /** Accept the required set + explicit optional choices. */
  accept: (opts: { marketing: boolean; analytics: boolean }) => Promise<boolean>;
  /** Decline at the gate — records the decline; the app must not proceed. */
  decline: () => Promise<void>;
  /** Withdraw a scope of consent from settings. */
  withdraw: (scope: 'marketing' | 'analytics' | 'CORE') => Promise<boolean>;
  /** Reset on logout. */
  reset: () => void;
  clearDeclined: () => void;
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

export const useConsentStore = create<ConsentState>((set, get) => ({
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
      set({ error: toApiError(e), loading: false });
    }
  },

  accept: async ({ marketing, analytics }) => {
    set({ submitting: true, error: null });
    try {
      const res = await legalApi.accept({ marketing, analytics });
      set({ status: res.status, phase: 'ready', submitting: false });
      return true;
    } catch (e) {
      set({ error: toApiError(e), submitting: false });
      return false;
    }
  },

  decline: async () => {
    set({ submitting: true, error: null });
    try {
      await legalApi.decline();
    } catch {
      // Best-effort record; we block regardless of the network result.
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
      set({ error: toApiError(e), submitting: false });
      return false;
    }
  },

  reset: () => set({ phase: 'unknown', status: null, error: null, loading: false, submitting: false }),
  clearDeclined: () => set({ phase: 'unknown' }),
}));
