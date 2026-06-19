import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useNavigation } from '@react-navigation/native';
import { notificationsApi } from '../api/notifications';
import { useNotificationStore } from '../store/notificationStore';
import { useAuthStore } from '../store/authStore';

// Expo Go (SDK 53+) does not support remote push. Detect it so we can skip
// registration without crashing — push still works in development builds.
const isExpoGo = Constants.appOwnership === 'expo';

// Configure how notifications appear when the app is foregrounded.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
    }),
  });
} catch {
  // Expo Go — handler may not be supported
}

/**
 * Full push notification lifecycle:
 *
 * 1. On auth → request permission, get Expo push token, register with backend
 * 2. On foreground notification → ingest into store (updates bell badge + inbox)
 * 3. On notification tap → deep-link to the relevant screen
 * 4. On logout → unregister the token from the backend
 *
 * In Expo Go: registration is skipped (not supported), but foreground and tap
 * listeners still work for local notifications. Build a dev build to test the
 * full remote push flow.
 */
export function usePushNotifications() {
  const nav = useNavigation<any>();
  const { activeRole } = useAuthStore();
  const ingestRealtime = useNotificationStore((s) => s.ingestRealtime);
  const fetchUnreadCount = useNotificationStore((s) => s.fetchUnreadCount);
  const tokenRef = useRef<string | null>(null);

  // ── Set up Android channels on mount ───────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    try {
      Notifications.setNotificationChannelAsync('urgent', {
        name: 'Urgent',
        description: 'Booking requests, payments, safety alerts',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
      Notifications.setNotificationChannelAsync('default', {
        name: 'General',
        description: 'Reviews, updates, and other notifications',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
      });
    } catch {
      // Expo Go — channels may not be supported
    }
  }, []);

  // ── Register push token (skipped in Expo Go) ──────────────────────────
  useEffect(() => {
    if (isExpoGo || !Device.isDevice) return;

    (async () => {
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== 'granted') return;

        const pushToken = await Notifications.getExpoPushTokenAsync();
        const token = pushToken.data;
        tokenRef.current = token;

        await notificationsApi.registerDeviceToken(
          token,
          Platform.OS as 'ios' | 'android',
        );
      } catch {
        // Silent — push is best-effort
      }
    })();
  }, []);

  // ── Foreground notification listener ───────────────────────────────────
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((event) => {
      const data = event.request.content.data;
      if (!data?.notification_id) return;

      ingestRealtime({
        id:           data.notification_id as string,
        type:         data.type as any,
        title:        event.request.content.title ?? '',
        body:         event.request.content.body ?? '',
        entity_type:  (data.entity_type as string) ?? null,
        entity_id:    (data.entity_id as string) ?? null,
        payment_mode: (data.payment_mode as string) ?? null,
        meta:         data as Record<string, any>,
        event_time:   (data.event_time as string) ?? new Date().toISOString(),
        created_at:   new Date().toISOString(),
      });
    });

    return () => sub.remove();
  }, [ingestRealtime]);

  // ── Notification tap handler (deep-link) ───────────────────────────────
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (!data) return;

      fetchUnreadCount();

      const entityType = data.entity_type as string | null;
      const entityId   = data.entity_id as string | null;
      const isProvider = activeRole === 'PROVIDER';

      if (!entityId) return;

      switch (entityType) {
        case 'booking':
          nav.navigate(isProvider ? 'Requests' : 'Bookings', {
            screen: 'BookingDetail',
            params: { bookingId: entityId },
          });
          break;
        case 'service':
          nav.navigate(isProvider ? 'Services' : 'Home', {
            screen: isProvider ? 'CreateService' : 'ServiceDetail',
            params: { serviceId: entityId },
          });
          break;
        case 'review':
          nav.navigate(isProvider ? 'Profile' : 'Home', {
            screen: 'AllReviews',
            params: { providerId: entityId },
          });
          break;
        case 'verification':
          nav.navigate(isProvider ? 'Hub' : 'Profile', { screen: 'Kyc' });
          break;
        default:
          nav.navigate(isProvider ? 'Hub' : 'Home', { screen: 'Notifications' });
          break;
      }
    });

    return () => sub.remove();
  }, [activeRole, nav, fetchUnreadCount]);

  return {
    unregisterPushToken: async () => {
      if (tokenRef.current) {
        try {
          await notificationsApi.unregisterDeviceToken(tokenRef.current);
        } catch {
          // Silent
        }
        tokenRef.current = null;
      }
    },
  };
}
