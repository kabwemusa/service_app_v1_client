import { api } from './client';

// ── Notification types (role-aware, payment-mode-aware) ──────────────────

export type NotificationRole = 'PROVIDER' | 'CUSTOMER' | 'SHARED';

export type NotificationType =
  // Provider types
  | 'NEW_BOOKING_REQUEST'
  | 'REQUEST_EXPIRING'
  | 'BOOKING_ACCEPTED'
  | 'BOOKING_UPCOMING'
  | 'BOOKING_STARTING'
  | 'CUSTOMER_MARKED_PAID'
  | 'NEW_REVIEW'
  | 'VERIFICATION_UPDATE'
  | 'TIER_PROGRESS'
  | 'LISTING_MODERATION'
  | 'REFERRAL_REWARD'
  | 'SAFETY_NOTICE'
  | 'ADMIN_NOTICE'
  // Customer types
  | 'REQUEST_ACCEPTED'
  | 'REQUEST_DECLINED'
  | 'REQUEST_EXPIRED'
  | 'QUOTE_RECEIVED'
  | 'PROVIDER_EN_ROUTE'
  | 'JOB_STARTED'
  | 'PAY_REMINDER'
  | 'CONFIRM_COMPLETION'
  | 'LEAVE_REVIEW'
  | 'BOOKING_REMINDER';

export type PaymentMode = 'DIRECT' | 'ESCROW';

export interface Notification {
  id:             string;
  type:           NotificationType;
  title:          string;
  body:           string;
  read_at:        string | null;
  created_at:     string;
  payment_mode:   PaymentMode | null;
  entity_type:    'booking' | 'service' | 'review' | 'verification' | 'referral' | 'safety_report' | null;
  entity_id:      string | null;
  meta:           Record<string, any> | null;
}

/** Realtime payload from WebSocket (notification.received event). */
export interface RealtimeNotification {
  id:            string;
  type:          NotificationType;
  title:         string;
  body:          string;
  entity_type:   string | null;
  entity_id:     string | null;
  payment_mode:  string | null;
  meta:          Record<string, any> | null;
  event_time:    string;
  created_at:    string;
}

export interface PaginatedNotifications {
  data:         Notification[];
  current_page: number;
  last_page:    number;
  total:        number;
  unread_count: number;
}

// ── Notification settings ────────────────────────────────────────────────

export type NotificationChannel = 'push' | 'sms' | 'in_app';

export type NotificationCategory =
  | 'bookings'
  | 'payments'
  | 'reviews'
  | 'verification'
  | 'moderation'
  | 'referrals'
  | 'safety'
  | 'marketing';

export type ChannelPreferences = Record<NotificationChannel, boolean>;

export type CategoryPreferences = Record<NotificationCategory, ChannelPreferences>;

export interface QuietHours {
  enabled: boolean;
  start:   string; // HH:mm
  end:     string; // HH:mm
}

export interface NotificationSettings {
  categories:  CategoryPreferences;
  quiet_hours: QuietHours;
}

// ── API ──────────────────────────────────────────────────────────────────

export const notificationsApi = {
  list: (page = 1, filter?: 'unread') =>
    api.get<PaginatedNotifications>('/notifications', {
      params: { page, filter },
    }),

  unreadCount: () =>
    api.get<{ count: number }>('/notifications/unread-count'),

  markRead: (id: string) =>
    api.patch<Notification>(`/notifications/${id}/read`, {}),

  markAllRead: () =>
    api.post<{ count: number }>('/notifications/mark-all-read', {}),

  /** Acknowledge delivery — stops SMS fallback for time-critical types. */
  ack: (id: string) =>
    api.post<{ acked: boolean }>(`/notifications/${id}/ack`, {}),

  /** Server UTC time for clock sync — derive all countdowns from event_time against this. */
  serverTime: () =>
    api.get<{ server_time: string }>('/notifications/server-time'),

  getSettings: () =>
    api.get<NotificationSettings>('/notifications/settings'),

  updateSettings: (settings: NotificationSettings) =>
    api.put<NotificationSettings>('/notifications/settings', settings),

  /** Register an Expo push token for OS-level notifications. */
  registerDeviceToken: (token: string, platform: 'ios' | 'android' | 'web') =>
    api.post<null>('/notifications/device-token', { token, platform }),

  /** Unregister the token on logout. */
  unregisterDeviceToken: (token: string) =>
    api.delete<null>(`/notifications/device-token?token=${encodeURIComponent(token)}`),
};
