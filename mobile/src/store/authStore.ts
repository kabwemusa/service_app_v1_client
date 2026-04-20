import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { authApi, AuthUser, LoginPayload, RegisterPayload } from '../api/auth';
import { ApiError } from '../api/errors';
import { useProfileStore } from './profileStore';
import { useServiceStore } from './serviceStore';

type AuthStep = 'idle' | 'awaiting_otp' | 'authenticated';

interface AuthState {
  step:           AuthStep;
  user:           AuthUser | null;
  pendingUserId:       string | null;
  pendingIdentifier:   string | null;  // email or phone used at registration
  loading:        boolean;
  error:          ApiError | null;
  register:  (payload: RegisterPayload) => Promise<void>;
  verifyOtp: (otp: string) => Promise<void>;
  login:     (payload: LoginPayload) => Promise<void>;
  resendOtp: () => Promise<void>;
  logout:    () => Promise<void>;
  hydrate:   () => Promise<void>;
  clearError: () => void;
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const msg = (e as any)?.message ?? 'Something went wrong.';
  return new ApiError(msg, 'SERVER_ERROR');
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad > 0 ? normalized + '='.repeat(4 - pad) : normalized;
  if (typeof global.atob !== 'function') {
    throw new Error('atob is not available in this runtime.');
  }
  return global.atob(padded);
}

function userFromToken(token: string): AuthUser | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const parsed = JSON.parse(base64UrlDecode(payload));
    if (!parsed?.role || !parsed?.email) return null;
    return {
      id: String(parsed.sub ?? ''),
      email: String(parsed.email),
      role: parsed.role,
      is_verified: true,
      completion_rate: 0,
      r_raw: 0,
      v_reviews: 0,
    } as AuthUser;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  step:               'idle',
  user:               null,
  pendingUserId:      null,
  pendingIdentifier:  null,
  loading:            false,
  error:              null,

  clearError: () => set({ error: null }),

  hydrate: async () => {
    const token = await AsyncStorage.getItem('access_token');
    if (!token) return;
    let user: AuthUser | null = null;
    const rawUser = await AsyncStorage.getItem('auth_user');
    if (rawUser) {
      try {
        user = JSON.parse(rawUser) as AuthUser;
      } catch {
        user = null;
      }
    }
    if (!user) {
      user = userFromToken(token);
    }
    set({ step: 'authenticated', user });
  },

  register: async (payload) => {
    set({ loading: true, error: null });
    try {
      const res = await authApi.register(payload);
      set({ step: 'awaiting_otp', pendingUserId: res.user_id, pendingIdentifier: payload.email ?? payload.phone ?? null });
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  verifyOtp: async (otp) => {
    const { pendingUserId } = get();
    if (!pendingUserId) return;
    set({ loading: true, error: null });
    try {
      const res = await authApi.verifyOtp({ user_id: pendingUserId, otp });
      useProfileStore.getState().reset();
      useServiceStore.getState().reset();
      set({ step: 'authenticated', user: res.user, pendingUserId: null, pendingIdentifier: null });
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  login: async (payload) => {
    set({ loading: true, error: null });
    try {
      const res = await authApi.login(payload);
      useProfileStore.getState().reset();
      useServiceStore.getState().reset();
      set({ step: 'authenticated', user: res.user });
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  resendOtp: async () => {
    const { pendingUserId } = get();
    if (!pendingUserId) return;
    set({ error: null });
    try {
      await authApi.resendOtp(pendingUserId);
    } catch (e) {
      set({ error: toApiError(e) });
    }
  },

  logout: async () => {
    set({ loading: true });
    try {
      await authApi.logout();
    } finally {
      useProfileStore.getState().reset();
      useServiceStore.getState().reset();
      set({
        step: 'idle',
        user: null,
        loading: false,
        pendingUserId: null,
        pendingIdentifier: null,
      });
    }
  },
}));
