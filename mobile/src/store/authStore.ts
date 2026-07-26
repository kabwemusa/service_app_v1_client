import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { authApi, AuthUser, LoginPayload, RegisterPayload } from '../api/auth';
import { ApiError } from '../api/errors';
import { useLocationStore } from './locationStore';
import { useProfileStore } from './profileStore';
import { useServiceStore } from './serviceStore';

type AuthStep = 'idle' | 'awaiting_otp' | 'authenticated';

// v3 §2.1 — a `PROVIDER`-role account "Can Buy AND Can Sell" on the same
// account; `activeRole` is a pure UI-mode toggle (brief §3) that picks which
// tab-bar layout shows. It never changes the backend `role` field.
export type ActiveRole = 'CUSTOMER' | 'PROVIDER';
const ACTIVE_ROLE_KEY = 'active_role';

function resolveActiveRole(user: AuthUser | null, saved: string | null): ActiveRole {
  if (user?.role !== 'PROVIDER') return 'CUSTOMER';
  return saved === 'CUSTOMER' ? 'CUSTOMER' : 'PROVIDER';
}

interface AuthState {
  step:           AuthStep;
  user:           AuthUser | null;
  activeRole:     ActiveRole;
  pendingUserId:       string | null;
  pendingIdentifier:   string | null;  // email or phone used at registration
  loading:        boolean;
  error:          ApiError | null;
  register:       (payload: RegisterPayload) => Promise<void>;
  verifyOtp:      (otp: string) => Promise<void>;
  login:          (payload: LoginPayload) => Promise<void>;
  resendOtp:      () => Promise<void>;
  logout:         () => Promise<void>;
  hydrate:        () => Promise<void>;
  setActiveRole:  (role: ActiveRole) => Promise<void>;
  updateAccount:  (payload: { phone?: string | null; name?: string | null }) => Promise<void>;
  uploadAvatar:   (asset: { uri: string; name: string; mimeType: string }) => Promise<void>;
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
  activeRole:         'CUSTOMER',
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
    const savedRole = await AsyncStorage.getItem(ACTIVE_ROLE_KEY);
    set({ step: 'authenticated', user, activeRole: resolveActiveRole(user, savedRole) });
  },

  /** Brief §3 — pure UI-mode toggle; swaps which tab-bar layout renders. Persisted per device. */
  setActiveRole: async (role) => {
    const { user } = get();
    if (user?.role !== 'PROVIDER') return;
    await AsyncStorage.setItem(ACTIVE_ROLE_KEY, role);
    set({ activeRole: role });
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
      useLocationStore.getState().reset();
      const savedRole = await AsyncStorage.getItem(ACTIVE_ROLE_KEY);
      set({
        step: 'authenticated',
        user: res.user,
        activeRole: resolveActiveRole(res.user, savedRole),
        pendingUserId: null,
        pendingIdentifier: null,
      });
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
      useLocationStore.getState().reset();
      const savedRole = await AsyncStorage.getItem(ACTIVE_ROLE_KEY);
      set({ step: 'authenticated', user: res.user, activeRole: resolveActiveRole(res.user, savedRole) });
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

  updateAccount: async (payload) => {
    set({ loading: true, error: null });
    try {
      const updatedUser = await authApi.updateAccount(payload);
      const merged = { ...get().user, ...updatedUser } as AuthUser;
      await AsyncStorage.setItem('auth_user', JSON.stringify(merged));
      set({ user: merged });
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  uploadAvatar: async (asset) => {
    set({ loading: true, error: null });
    try {
      const updatedUser = await authApi.uploadAvatar(asset);
      const merged = { ...get().user, ...updatedUser } as AuthUser;
      await AsyncStorage.setItem('auth_user', JSON.stringify(merged));
      set({ user: merged });
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    set({ loading: true });
    try {
      await authApi.logout();
    } finally {
      useProfileStore.getState().reset();
      useServiceStore.getState().reset();
      useLocationStore.getState().reset();
      set({
        step: 'idle',
        user: null,
        activeRole: 'CUSTOMER',
        loading: false,
        pendingUserId: null,
        pendingIdentifier: null,
      });
    }
  },
}));
