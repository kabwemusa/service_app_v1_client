import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './client';

export type UserRole = 'CUSTOMER' | 'PROVIDER' | 'ADMIN' | 'MODERATOR';
export type AccountState = 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED' | 'BANNED' | 'PENDING_CLOSURE';

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  account_state: AccountState;
  is_verified: boolean;
  completion_rate: number;
  r_raw: number;
  v_reviews: number;
}

export interface RegisterPayload {
  email?: string;
  phone?: string;
  password: string;
  role?: Extract<UserRole, 'CUSTOMER' | 'PROVIDER'>;
  referral_code?: string;
}

export interface OtpPayload {
  user_id: string;
  otp: string;
}

export interface LoginPayload {
  identifier: string;  // email or phone
  password: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

export interface RegisterResponse {
  message: string;
  user_id: string;
}

export const authApi = {
  register: (payload: RegisterPayload) =>
    api.post<RegisterResponse>('/auth/register', payload),

  verifyOtp: async (payload: OtpPayload): Promise<AuthResponse> => {
    const data = await api.post<AuthResponse>('/auth/verify-otp', payload);
    await AsyncStorage.multiSet([
      ['access_token', data.access_token],
      ['refresh_token', data.refresh_token],
      ['auth_user', JSON.stringify(data.user)],
    ]);
    return data;
  },

  login: async (payload: LoginPayload): Promise<AuthResponse> => {
    const data = await api.post<AuthResponse>('/auth/login', payload);
    await AsyncStorage.multiSet([
      ['access_token', data.access_token],
      ['refresh_token', data.refresh_token],
      ['auth_user', JSON.stringify(data.user)],
    ]);
    return data;
  },

  resendOtp: (userId: string) =>
    api.post('/auth/resend-otp', { user_id: userId }),

  logout: async () => {
    try {
      const refreshToken = await AsyncStorage.getItem('refresh_token');
      await api.post('/auth/logout', { refresh_token: refreshToken });
    } catch {
      // Best-effort server-side invalidation — always clear local tokens.
    } finally {
      await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'auth_user']);
    }
  },
};
