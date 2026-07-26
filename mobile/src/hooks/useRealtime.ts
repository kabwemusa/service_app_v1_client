import { useEffect } from "react";
import { RealtimeNotification } from "../api/notifications";
import { connectEcho, disconnectEcho, pusherConnection } from "../realtime/echo";
import { useAuthStore } from "../store/authStore";
import { useNotificationStore } from "../store/notificationStore";
import { useRealtimeStore } from "../store/realtimeStore";

/**
 * Live updates over Reverb (Laravel WebSockets). Subscribes the signed-in user
 * to their private channel and routes `notification.received` events to:
 *   • the notification store (bell badge + inbox update instantly), and
 *   • the realtime store's booking ping (so open booking screens refetch live —
 *     provider sees a new request, both parties see status changes, no reload).
 *
 * Push notifications remain the background/killed-app delivery path; this is the
 * foreground live channel. Both dedupe by notification id in the store.
 */
export function useRealtime() {
  const userId = useAuthStore((s) => s.user?.id);
  const ingestRealtime = useNotificationStore((s) => s.ingestRealtime);
  const fetchUnreadCount = useNotificationStore((s) => s.fetchUnreadCount);
  const setConnected = useRealtimeStore((s) => s.setConnected);
  const pingBooking = useRealtimeStore((s) => s.pingBooking);
  const pingPlacements = useRealtimeStore((s) => s.pingPlacements);

  useEffect(() => {
    if (!userId) {
      try { disconnectEcho(); } catch { /* best-effort */ }
      setConnected(false);
      return;
    }

    // Realtime is strictly best-effort: it must NEVER be able to crash the app
    // (e.g. a client construction error). Any failure degrades to push +
    // focus-refresh, which already work. So the whole setup is guarded.
    const channelName = `user.${userId}`;
    let echo: ReturnType<typeof connectEcho> | null = null;
    let channel: any = null;
    let placementsChannel: any = null;
    let conn: any = null;
    const onConnected = () => setConnected(true);
    const onDisconnected = () => setConnected(false);

    try {
      echo = connectEcho();
      channel = echo.private(channelName);

      channel.listen(".notification.received", (payload: RealtimeNotification) => {
        // Bell + inbox (deduped by id in the store).
        ingestRealtime(payload);
        fetchUnreadCount();

        // Nudge any mounted booking screen to refetch immediately.
        if (payload.entity_type === "booking") {
          pingBooking(payload.entity_id ?? null);
        }
      });

      // Growth & Promotions: a PUBLIC channel every client listens on. When a
      // campaign launches/pauses/ends/exhausts its budget, refetch home banners
      // + search so it appears or disappears without a reload. No auth, no PII —
      // the payload only says "something changed"; the client re-evaluates its
      // own eligibility server-side.
      placementsChannel = echo.channel("placements");
      placementsChannel.listen(".campaign.changed", () => pingPlacements());

      // Track connection state for an optional "reconnecting…" indicator.
      conn = pusherConnection();
      conn?.bind("connected", onConnected);
      conn?.bind("disconnected", onDisconnected);
      conn?.bind("unavailable", onDisconnected);
    } catch (e) {
      console.warn("useRealtime: live connection unavailable — falling back to push/refresh", e);
      setConnected(false);
    }

    return () => {
      try {
        channel?.stopListening(".notification.received");
        placementsChannel?.stopListening(".campaign.changed");
        echo?.leave(channelName);
        echo?.leave("placements");
      } catch {
        // best-effort
      }
      conn?.unbind("connected", onConnected);
      conn?.unbind("disconnected", onDisconnected);
      conn?.unbind("unavailable", onDisconnected);
      setConnected(false);
    };
  }, [userId, ingestRealtime, fetchUnreadCount, setConnected, pingBooking, pingPlacements]);
}
