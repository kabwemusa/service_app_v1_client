import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Notification, NotificationType } from '../../api/notifications';
import { Card, Divider } from '../../components/ui/Card';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { Tabs } from '../../components/ui/Tabs';
import { useNotificationStore, eventRelativeTime } from '../../store/notificationStore';
import { useAuthStore } from '../../store/authStore';
import { palette, radius as r, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ── Theme (dark/light, AA) ──────────────────────────────────────────────
type ThemeC = { bg: string; surface: string; border: string; t1: string; t2: string; t3: string; unreadBg: string };
const DARK:  ThemeC = { bg: '#0F0A0D', surface: '#1C1015', border: '#3A2030', t1: '#F5E8EE', t2: '#C79BB0', t3: '#7C5868', unreadBg: '#251520' };
const LIGHT: ThemeC = { bg: palette.background, surface: palette.surface, border: palette.border, t1: palette.textPrimary, t2: palette.textSecondary, t3: palette.textDisabled, unreadBg: palette.primaryLight };

// ── Notification type metadata (icon, colour, deep-link target) ─────────

interface TypeMeta {
  icon:       IconName;
  color:      string;
  bg:         string;
  deepLink:   'booking' | 'service' | 'review' | 'kyc' | 'hub' | 'safety' | 'referral' | 'none';
}

const TYPE_META: Record<NotificationType, TypeMeta> = {
  // Provider — booking flow
  NEW_BOOKING_REQUEST:   { icon: 'flash-outline',          color: palette.warning,       bg: palette.warningLight,  deepLink: 'booking' },
  REQUEST_EXPIRING:      { icon: 'alarm-outline',          color: palette.danger,        bg: palette.dangerLight,   deepLink: 'booking' },
  BOOKING_ACCEPTED:      { icon: 'checkmark-circle-outline', color: palette.success,     bg: palette.successLight,  deepLink: 'booking' },
  BOOKING_UPCOMING:      { icon: 'calendar-outline',       color: palette.primary,       bg: palette.primaryLight,  deepLink: 'booking' },
  BOOKING_STARTING:      { icon: 'play-circle-outline',    color: palette.primary,       bg: palette.primaryLight,  deepLink: 'booking' },
  CUSTOMER_MARKED_PAID:  { icon: 'cash-outline',           color: palette.success,       bg: palette.successLight,  deepLink: 'booking' },
  NEW_REVIEW:            { icon: 'star-outline',           color: palette.warning,       bg: palette.warningLight,  deepLink: 'review' },
  VERIFICATION_UPDATE:   { icon: 'shield-checkmark-outline', color: palette.success,     bg: palette.successLight,  deepLink: 'kyc' },
  TIER_PROGRESS:         { icon: 'trending-up-outline',    color: palette.primary,       bg: palette.primaryLight,  deepLink: 'kyc' },
  LISTING_MODERATION:    { icon: 'alert-circle-outline',   color: palette.warning,       bg: palette.warningLight,  deepLink: 'service' },
  REFERRAL_REWARD:       { icon: 'gift-outline',           color: palette.success,       bg: palette.successLight,  deepLink: 'referral' },
  SAFETY_NOTICE:         { icon: 'warning-outline',        color: palette.danger,        bg: palette.dangerLight,   deepLink: 'safety' },
  ADMIN_NOTICE:          { icon: 'information-circle-outline', color: palette.textSecondary, bg: palette.primaryLight, deepLink: 'none' },

  // Customer — booking flow
  REQUEST_ACCEPTED:      { icon: 'checkmark-circle-outline', color: palette.success,     bg: palette.successLight,  deepLink: 'booking' },
  REQUEST_DECLINED:      { icon: 'close-circle-outline',   color: palette.danger,        bg: palette.dangerLight,   deepLink: 'booking' },
  REQUEST_EXPIRED:       { icon: 'time-outline',           color: palette.textSecondary, bg: palette.primaryLight,  deepLink: 'booking' },
  QUOTE_RECEIVED:        { icon: 'pricetag-outline',       color: palette.primary,       bg: palette.primaryLight,  deepLink: 'booking' },
  PROVIDER_EN_ROUTE:     { icon: 'navigate-outline',       color: palette.primary,       bg: palette.primaryLight,  deepLink: 'booking' },
  JOB_STARTED:           { icon: 'play-circle-outline',    color: palette.primary,       bg: palette.primaryLight,  deepLink: 'booking' },
  PAY_REMINDER:          { icon: 'wallet-outline',         color: palette.warning,       bg: palette.warningLight,  deepLink: 'booking' },
  CONFIRM_COMPLETION:    { icon: 'checkmark-done-outline', color: palette.success,       bg: palette.successLight,  deepLink: 'booking' },
  LEAVE_REVIEW:          { icon: 'create-outline',         color: palette.primary,       bg: palette.primaryLight,  deepLink: 'booking' },
  BOOKING_REMINDER:      { icon: 'notifications-outline',  color: palette.primary,       bg: palette.primaryLight,  deepLink: 'booking' },
};

const URGENT_TYPES: Set<NotificationType> = new Set([
  'NEW_BOOKING_REQUEST', 'REQUEST_EXPIRING', 'PAY_REMINDER', 'SAFETY_NOTICE',
]);

// ── Helpers ──────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function dateGroupKey(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - itemDate.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)   return 'Earlier this week';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface NotificationGroup {
  key:   string;
  title: string;
  items: Notification[];
}

function groupByDate(notifications: Notification[]): NotificationGroup[] {
  const map = new Map<string, Notification[]>();
  for (const n of notifications) {
    const key = dateGroupKey(n.created_at);
    const group = map.get(key);
    if (group) group.push(n);
    else map.set(key, [n]);
  }
  return Array.from(map.entries()).map(([key, items]) => ({ key, title: key, items }));
}

// ── Deep-linking ────────────────────────────────────────────────────────

function useDeepLink() {
  const nav = useNavigation<any>();
  const { activeRole } = useAuthStore();
  const isProvider = activeRole === 'PROVIDER';

  return useCallback((n: Notification) => {
    const meta = TYPE_META[n.type];
    if (!meta || !n.entity_id) return;

    switch (meta.deepLink) {
      case 'booking':
        nav.navigate(isProvider ? 'Requests' : 'Bookings', {
          screen: 'BookingDetail',
          params: { bookingId: n.entity_id },
        });
        break;
      case 'service':
        nav.navigate(isProvider ? 'Services' : 'Home', {
          screen: isProvider ? 'CreateService' : 'ServiceDetail',
          params: { serviceId: n.entity_id },
        });
        break;
      case 'review':
        nav.navigate(isProvider ? 'Profile' : 'Home', {
          screen: 'AllReviews',
          params: { providerId: n.entity_id },
        });
        break;
      case 'kyc':
        nav.navigate(isProvider ? 'Hub' : 'Profile', {
          screen: 'Kyc',
        });
        break;
      case 'safety':
      case 'referral':
      case 'none':
        break;
    }
  }, [nav, isProvider]);
}

// ── Notification item row ───────────────────────────────────────────────

function NotificationRow({
  item,
  c,
  onPress,
  isLast,
}: {
  item:     Notification;
  c:        ThemeC;
  onPress:  (n: Notification) => void;
  isLast:   boolean;
}) {
  const meta = TYPE_META[item.type];
  const unread = !item.read_at;
  const urgent = URGENT_TYPES.has(item.type);
  const eventTime = item.meta?.event_time ?? item.created_at;

  return (
    <>
      <TouchableRipple
        onPress={() => onPress(item)}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'Unread: ' : ''}${item.title}. ${item.body}. ${eventRelativeTime(eventTime)}`}
        accessibilityHint={item.entity_id ? 'Double-tap to open' : undefined}
        borderless
        style={[styles.rowWrap, unread && { backgroundColor: c.unreadBg }]}
      >
        <View style={styles.row}>
          {/* Type icon chip */}
          <View style={[styles.iconChip, { backgroundColor: meta?.bg ?? palette.primaryLight }]}>
            <Ionicons name={meta?.icon ?? 'notifications-outline'} size={18} color={meta?.color ?? palette.textSecondary} />
          </View>

          {/* Content */}
          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text
                style={[
                  styles.title,
                  { color: c.t1 },
                  urgent && unread && styles.titleUrgent,
                ]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              <Text
                style={[styles.time, { color: c.t3 }]}
                accessibilityLabel={absoluteTime(item.created_at)}
              >
                {eventRelativeTime(eventTime)}
              </Text>
            </View>
            <Text style={[styles.body, { color: c.t2 }]} numberOfLines={2}>
              {item.body}
            </Text>
          </View>

          {/* Unread dot */}
          {unread && (
            <View
              style={styles.unreadDot}
              accessibilityLabel="Unread"
            />
          )}
        </View>
      </TouchableRipple>
      {!isLast && <Divider inset={spacing.md + 36 + spacing.sm} />}
    </>
  );
}

// ── Empty states ────────────────────────────────────────────────────────

function EmptyState({ isUnread, c }: { isUnread: boolean; c: ThemeC }) {
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name="notifications-off-outline" size={48} color={c.t3} />
      <Text style={[styles.emptyTitle, { color: c.t1 }]}>
        {isUnread ? 'No unread notifications' : "You're all caught up"}
      </Text>
      <Text style={[styles.emptyBody, { color: c.t2 }]}>
        {isUnread
          ? "All notifications have been read."
          : "When something happens, you'll see it here."}
      </Text>
    </View>
  );
}

function SkeletonList() {
  return (
    <View style={styles.skeletonWrap}>
      {[1, 2, 3, 4].map((i) => (
        <CardSkeleton key={i} />
      ))}
    </View>
  );
}

// ── Main screen ─────────────────────────────────────────────────────────

type TabKey = 'all' | 'unread';

export default function NotificationsScreen() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? DARK : LIGHT;
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const deepLink = useDeepLink();

  const {
    notifications,
    unreadCount,
    loading,
    refreshing,
    fetchNotifications,
    loadMore,
    refresh,
    markRead,
    markAllRead,
    fetchUnreadCount,
    syncClock,
  } = useNotificationStore();

  const [tab, setTab] = useState<TabKey>('all');
  const filter = tab === 'unread' ? 'unread' as const : undefined;

  useEffect(() => {
    syncClock();
  }, []);

  useEffect(() => {
    fetchNotifications(true, filter);
    fetchUnreadCount();
  }, [tab]);

  const groups = useMemo(() => groupByDate(notifications), [notifications]);

  const handlePress = useCallback((n: Notification) => {
    if (!n.read_at) markRead(n.id);
    deepLink(n);
  }, [markRead, deepLink]);

  const handleLoadMore = useCallback(() => loadMore(filter), [filter, loadMore]);
  const handleRefresh  = useCallback(() => refresh(filter),  [filter, refresh]);

  const tabItems = useMemo(() => [
    { key: 'all',    label: 'All' },
    { key: 'unread', label: 'Unread', count: unreadCount || undefined },
  ], [unreadCount]);

  // ── Render ──────────────────────────────────────────────────────────

  const renderGroup = ({ item: group }: { item: NotificationGroup }) => (
    <View style={styles.groupWrap}>
      <Text style={[styles.groupTitle, { color: c.t2 }]}>{group.title}</Text>
      <Card padding={0} style={[styles.groupCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        {group.items.map((n, idx) => (
          <NotificationRow
            key={n.id}
            item={n}
            c={c}
            onPress={handlePress}
            isLast={idx === group.items.length - 1}
          />
        ))}
      </Card>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable
          onPress={() => nav.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.headerBtn}
        >
          <Ionicons name="arrow-back" size={24} color={c.t1} />
        </Pressable>

        <Text style={[styles.headerTitle, { color: c.t1 }]}>Notifications</Text>

        <View style={styles.headerRight}>
          {unreadCount > 0 && (
            <Pressable
              onPress={markAllRead}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Mark all as read"
              style={styles.headerBtn}
            >
              <Ionicons name="checkmark-done-outline" size={22} color={palette.primary} />
            </Pressable>
          )}
          <Pressable
            onPress={() => nav.navigate('NotificationSettings')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Notification settings"
            style={styles.headerBtn}
          >
            <Ionicons name="settings-outline" size={22} color={c.t2} />
          </Pressable>
        </View>
      </View>

      {/* Tabs */}
      <Tabs
        items={tabItems}
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
      />

      {/* Content */}
      {loading && notifications.length === 0 ? (
        <SkeletonList />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.key}
          renderItem={renderGroup}
          contentContainerStyle={[
            styles.listContent,
            groups.length === 0 && styles.listEmpty,
          ]}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={palette.primary}
              colors={[palette.primary]}
            />
          }
          ListEmptyComponent={<EmptyState isUnread={tab === 'unread'} c={c} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  headerBtn:    { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { ...typography.heading3, flex: 1, marginLeft: spacing.xs },
  headerRight:  { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },

  // List
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  listEmpty:   { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Group
  groupWrap:  { marginTop: spacing.md },
  groupTitle: { ...typography.label, marginBottom: spacing.xs, marginLeft: spacing.xs },
  groupCard:  {},

  // Row
  rowWrap:  { borderRadius: r.sm },
  row:      { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 12 },
  iconChip: {
    width: 36, height: 36, borderRadius: r.sm,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  content:   { flex: 1, marginLeft: spacing.sm },
  titleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title:     { ...typography.bodySmall, fontFamily: 'DMSans_500Medium', flex: 1 },
  titleUrgent: { fontFamily: 'DMSans_600SemiBold' },
  time:      { ...typography.bodySmall, fontSize: 12 },
  body:      { ...typography.bodySmall, marginTop: 2 },
  unreadDot: {
    width: 8, height: 8, borderRadius: r.full,
    backgroundColor: palette.primary,
    marginLeft: spacing.sm,
    marginTop: 6,
  },

  // Empty
  emptyWrap:  { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { ...typography.heading3, textAlign: 'center' },
  emptyBody:  { ...typography.body, textAlign: 'center' },

  // Skeleton
  skeletonWrap: { padding: spacing.md, gap: spacing.sm },
});
