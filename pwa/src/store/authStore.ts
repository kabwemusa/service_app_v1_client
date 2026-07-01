import { create } from 'zustand';
import { api, tokens, type ApiError } from '../api/client';

// Phone is the single identity key. The PWA never asks for a password — only
// phone + OTP. A returning user with a stored token resumes silently.

export interface AuthUser {
  id: string;
  phone: string | null;
  email: string | null;
  role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN' | 'MODERATOR';
  is_verified: boolean;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: ApiError | null;
  requestOtp: (phone: string, intent?: 'CUSTOMER' | 'PROVIDER') => Promise<{ phone: string; resend_after: number } | null>;
  verifyOtp: (phone: string, otp: string, guestToken?: string | null) => Promise<boolean>;
  hydrate: () => void;
  logout: () => void;
  clearError: () => void;
}

function decodeUser(): AuthUser | null {
  const t = tokens.access;
  if (!t) return null;
  try {
    const [, payload] = t.split('.');
    const p = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return {
      id: String(p.sub ?? ''),
      phone: p.phone ?? null,
      email: p.email ?? null,
      role: p.role ?? 'CUSTOMER',
      is_verified: true,
    };
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  error: null,

  clearError: () => set({ error: null }),

  hydrate: () => set({ user: decodeUser() }),

  requestOtp: async (phone, intent = 'CUSTOMER') => {
    set({ loading: true, error: null });
    try {
      const res = await api.post<{ phone: string; resend_after: number }>('/auth/otp/request', { phone, intent });
      return res;
    } catch (e) {
      set({ error: e as ApiError });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  verifyOtp: async (phone, otp, guestToken = null) => {
    set({ loading: true, error: null });
    try {
      const res = await api.post<{ access_token: string; refresh_token: string; user: AuthUser }>(
        '/auth/otp/verify',
        { phone, otp, guest_token: guestToken },
      );
      tokens.set(res.access_token, res.refresh_token);
      set({ user: res.user });
      return true;
    } catch (e) {
      set({ error: e as ApiError });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  logout: () => {
    tokens.clear();
    set({ user: null });
  },
}));
