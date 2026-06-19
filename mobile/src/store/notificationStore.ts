import { create } from 'zustand';
import { ApiError } from '../api/errors';
import {
  Notification,
  NotificationSettings,
  PaginatedNotifications,
  RealtimeNotification,
  notificationsApi,
} from '../api/notifications';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

const DEFAULT_SETTINGS: NotificationSettings = {
  categories: {
    bookings:     { push: true, sms: true,  in_app: true },
    payments:     { push: true, sms: true,  in_app: true },
    reviews:      { push: true, sms: false, in_app: true },
    verification: { push: true, sms: false, in_app: true },
    moderation:   { push: true, sms: false, in_app: true },
    referrals:    { push: true, sms: false, in_app: true },
    safety:       { push: true, sms: true,  in_app: true },
    marketing:    { push: false, sms: false, in_app: true },
  },
  quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
};

interface NotificationState {
  notifications:  Notification[];
  page:           number;
  lastPage:       number;
  total:          number;
  unreadCount:    number;
  loading:        boolean;
  refreshing:     boolean;
  error:          ApiError | null;

  // Clock sync: offset = server_time - local_time (ms). Add to Date.now() for server-accurate time.
  clockOffsetMs:  number;

  // Dedup: set of notification IDs already in the list (WebSocket + push dedup)
  seenIds:        Set<string>;

  settings:        NotificationSettings;
  settingsLoading: boolean;
  settingsError:   ApiError | null;

  fetchNotifications: (reset?: boolean, filter?: 'unread') => Promise<void>;
  loadMore:           (filter?: 'unread') => Promise<void>;
  refresh:            (filter?: 'unread') => Promise<void>;
  fetchUnreadCount:   () => Promise<void>;
  markRead:           (id: string) => Promise<void>;
  markAllRead:        () => Promise<void>;

  /** Ingest a realtime notification from WebSocket. Deduplicates by id. */
  ingestRealtime:     (payload: RealtimeNotification) => void;

  /** Acknowledge delivery to server (stops SMS fallback). */
  ackDelivery:        (id: string) => void;

  /** Sync local clock against server UTC. */
  syncClock:          () => Promise<void>;

  /** Server-accurate "now" — Date.now() + clockOffsetMs. */
  serverNow:          () => number;

  fetchSettings:      () => Promise<void>;
  updateSettings:     (settings: NotificationSettings) => Promise<void>;

  clearError:         () => void;
  reset:              () => void;
}

const initialState = {
  notifications:   [] as Notification[],
  page:            1,
  lastPage:        1,
  total:           0,
  unreadCount:     0,
  loading:         false,
  refreshing:      false,
  error:           null,
  clockOffsetMs:   0,
  seenIds:         new Set<string>(),
  settings:        DEFAULT_SETTINGS,
  settingsLoading: false,
  settingsError:   null,
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  ...initialState,

  clearError: () => set({ error: null }),
  reset: () => set({ ...initialState, seenIds: new Set() }),

  serverNow: () => Date.now() + get().clockOffsetMs,

  syncClock: async () => {
    try {
      const before = Date.now();
      const { server_time } = await notificationsApi.serverTime();
      const after = Date.now();
      const rtt = after - before;
      const serverMs = new Date(server_time).getTime();
      // Estimate server time at the midpoint of the request
      const offset = serverMs - (before + rtt / 2);
      set({ clockOffsetMs: offset });
    } catch {
      // non-critical — times will be approximately correct
    }
  },

  fetchNotifications: async (reset = true, filter) => {
    const page = reset ? 1 : get().page;
    set({ loading: true, error: null });
    try {
      const result: PaginatedNotifications = await notificationsApi.list(page, filter);
      const newSeenIds = new Set(get().seenIds);
      for (const n of result.data) newSeenIds.add(n.id);

      set((s) => ({
        notifications: reset ? result.data : [...s.notifications, ...result.data],
        page:          result.current_page,
        lastPage:      result.last_page,
        total:         result.total,
        unreadCount:   result.unread_count,
        seenIds:       newSeenIds,
      }));
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  loadMore: async (filter) => {
    const { page, lastPage, loading } = get();
    if (loading || page >= lastPage) return;
    set((s) => ({ page: s.page + 1 }));
    await get().fetchNotifications(false, filter);
  },

  refresh: async (filter) => {
    set({ refreshing: true });
    await get().fetchNotifications(true, filter);
    set({ refreshing: false });
  },

  fetchUnreadCount: async () => {
    try {
      const { count } = await notificationsApi.unreadCount();
      set({ unreadCount: count });
    } catch {
      // silent
    }
  },

  markRead: async (id) => {
    try {
      const updated = await notificationsApi.markRead(id);
      set((s) => ({
        notifications: s.notifications.map((n) => (n.id === id ? updated : n)),
        unreadCount:   Math.max(0, s.unreadCount - (s.notifications.find((n) => n.id === id && !n.read_at) ? 1 : 0)),
      }));
    } catch {
      // silent
    }
  },

  markAllRead: async () => {
    const prevCount = get().unreadCount;
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
      unreadCount:   0,
    }));
    try {
      await notificationsApi.markAllRead();
    } catch {
      set({ unreadCount: prevCount });
    }
  },

  ingestRealtime: (payload) => {
    const { seenIds } = get();

    // Dedup: skip if already seen (delivered via both WebSocket and push)
    if (seenIds.has(payload.id)) return;

    const notification: Notification = {
      id:           payload.id,
      type:         payload.type,
      title:        payload.title,
      body:         payload.body,
      read_at:      null,
      created_at:   payload.created_at,
      payment_mode: (payload.payment_mode as any) ?? null,
      entity_type:  (payload.entity_type as any) ?? null,
      entity_id:    payload.entity_id,
      meta:         payload.meta ? { ...payload.meta, event_time: payload.event_time } : { event_time: payload.event_time },
    };

    const newSeenIds = new Set(seenIds);
    newSeenIds.add(payload.id);

    set((s) => ({
      notifications: [notification, ...s.notifications],
      unreadCount:   s.unreadCount + 1,
      total:         s.total + 1,
      seenIds:       newSeenIds,
    }));

    // Acknowledge delivery to stop SMS fallback
    get().ackDelivery(payload.id);
  },

  ackDelivery: (id) => {
    notificationsApi.ack(id).catch(() => {
      // silent — ack is best-effort
    });
  },

  fetchSettings: async () => {
    set({ settingsLoading: true, settingsError: null });
    try {
      const settings = await notificationsApi.getSettings();
      set({ settings });
    } catch (e) {
      set({ settingsError: toApiError(e) });
    } finally {
      set({ settingsLoading: false });
    }
  },

  updateSettings: async (settings) => {
    const prev = get().settings;
    set({ settings, settingsError: null });
    try {
      const saved = await notificationsApi.updateSettings(settings);
      set({ settings: saved });
    } catch (e) {
      set({ settings: prev, settingsError: toApiError(e) });
      throw toApiError(e);
    }
  },
}));

// ── Event-time helpers (use these instead of raw Date arithmetic) ─────────

/**
 * Server-accurate relative time from an event_time ISO string.
 * Uses the synced clock offset so display is second-accurate regardless of
 * push delivery jitter.
 */
export function eventRelativeTime(eventTimeIso: string): string {
  const serverNow = useNotificationStore.getState().serverNow();
  const eventMs = new Date(eventTimeIso).getTime();
  const diff = serverNow - eventMs;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(eventTimeIso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Countdown remaining from a deadline ISO string (e.g. response_deadline).
 * Returns { text, expired, totalSeconds } — second-accurate via synced clock.
 */
export function eventCountdown(deadlineIso: string): { text: string; expired: boolean; totalSeconds: number } {
  const serverNow = useNotificationStore.getState().serverNow();
  const deadlineMs = new Date(deadlineIso).getTime();
  const remaining = deadlineMs - serverNow;

  if (remaining <= 0) return { text: 'Expired', expired: true, totalSeconds: 0 };

  const totalSeconds = Math.ceil(remaining / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return { text: `${h}h ${m}m`, expired: false, totalSeconds };
  }

  return { text: `${mins}m ${secs}s`, expired: false, totalSeconds };
}
