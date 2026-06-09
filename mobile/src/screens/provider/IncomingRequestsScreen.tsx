import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Chip, ProgressBar, SegmentedButtons, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { IncomingRequestEntry, TrustHint } from '../../api/bookings';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useBookingStore } from '../../store/bookingStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type TabKey = 'new' | 'scheduled';

// §8 — discreet, qualitative buyer trust hint. "New customer" is deliberately
// neutral (never a warning colour): v3 §10.2 already blocks risky buyers
// server-side, so a warning tint here would just bias providers against them.
const TRUST_HINT_META: Record<TrustHint, { label: string; icon: IconName; color: string; bg: string }> = {
  REPEAT_CLIENT: { label: 'Repeat client',    icon: 'heart',                    color: palette.success,       bg: palette.successLight },
  TRUSTED:       { label: 'Trusted customer', icon: 'shield-checkmark-outline', color: palette.primary,       bg: palette.primaryLight },
  NEW:           { label: 'New customer',     icon: 'person-add-outline',       color: palette.textSecondary, bg: '#EFEFEF'            },
};

function timeSince(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatScheduled(iso: string | null): string {
  if (!iso) return 'Time to be confirmed';
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function RequestCard({ entry, onPress }: { entry: IncomingRequestEntry; onPress: () => void }) {
  const hint = TRUST_HINT_META[entry.trust_hint];
  const locationLabel = entry.delivery_label ?? entry.delivery_region ?? 'Location on file';

  return (
    <TouchableRipple onPress={onPress} borderless style={styles.cardWrap}>
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={18} color={palette.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.buyerName} numberOfLines={1}>{entry.buyer_label}</Text>
            <View style={[styles.hintPill, { backgroundColor: hint.bg }]}>
              <Ionicons name={hint.icon} size={11} color={hint.color} />
              <Text style={[styles.hintText, { color: hint.color }]}>{hint.label}</Text>
            </View>
          </View>
          {!!entry.created_at && (
            <View style={styles.timerPill}>
              <Ionicons name="time-outline" size={12} color={palette.textSecondary} />
              <Text style={styles.timerText}>{timeSince(entry.created_at)}</Text>
            </View>
          )}
        </View>

        <Text style={styles.serviceTitle} numberOfLines={1}>{entry.service_title ?? 'Service'}</Text>

        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={14} color={palette.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1}>{formatScheduled(entry.scheduled_start)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={14} color={palette.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1}>
            {locationLabel}{entry.distance_km != null ? ` · ${entry.distance_km} km away` : ''}
          </Text>
        </View>

        <View style={styles.netRow}>
          <Text style={styles.netText} numberOfLines={1}>
            You keep <Text style={styles.netStrong}>ZMW {entry.net_zmw.toFixed(0)}</Text> of ZMW {entry.gross_zmw.toFixed(0)}
          </Text>
          {entry.pricing_model === 'QUOTE' && (
            <Chip compact mode="flat" style={styles.quoteChip} textStyle={styles.quoteChipText}>By quote</Chip>
          )}
        </View>

        <View style={styles.escrowRow}>
          <Ionicons name="lock-closed-outline" size={13} color={palette.success} />
          <Text style={styles.escrowText} numberOfLines={1}>{entry.escrow_label}</Text>
          <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
        </View>
      </View>
    </TouchableRipple>
  );
}

export default function IncomingRequestsScreen({ navigation }: any) {
  const [tab, setTab] = useState<TabKey>('new');
  const {
    incomingRequests, incomingLoading, incomingError,
    fetchIncomingRequests, clearIncomingError,
  } = useBookingStore();
  const { showError } = useSnackbar();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    fetchIncomingRequests();
  }, []);

  useEffect(() => {
    if (incomingError) {
      showError(incomingError.message);
      clearIncomingError();
    }
  }, [incomingError]);

  const Header = () => (
    <View style={styles.header}>
      <Text style={styles.title}>Requests</Text>
      <Text style={styles.subtitle}>Funded jobs waiting on you — accepted automatically once escrow is in place.</Text>
    </View>
  );

  if (incomingLoading && !incomingRequests) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header />
        <View style={styles.skeletons}>
          {[1, 2, 3].map((key) => <CardSkeleton key={key} style={styles.skeleton} />)}
        </View>
      </SafeAreaView>
    );
  }

  if (!incomingRequests) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header />
      </SafeAreaView>
    );
  }

  const { weekly, response_nudge, new: newRequests, scheduled } = incomingRequests;
  const weeklyProgress = weekly.weekly_cap_zmw ? Math.min(weekly.this_week_zmw / weekly.weekly_cap_zmw, 1) : 1;
  const list = tab === 'new' ? newRequests : scheduled;

  return (
    <SafeAreaView style={styles.safe}>
      <Header />
      <FlatList
        data={list}
        keyExtractor={(item) => item.booking_id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 120 }]}
        ListHeaderComponent={(
          <View style={styles.listHeader}>
            {/* Weekly earnings vs cap */}
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionLabel}>This week's earnings</Text>
                <Text style={styles.weeklyValue}>ZMW {weekly.this_week_zmw.toFixed(0)}</Text>
              </View>
              {weekly.weekly_cap_zmw != null ? (
                <>
                  <ProgressBar progress={weeklyProgress} color={weeklyProgress >= 1 ? palette.warning : palette.success} style={styles.bar} />
                  <Text style={styles.cardBody}>of your ZMW {weekly.weekly_cap_zmw} weekly cap</Text>
                </>
              ) : (
                <Text style={styles.cardBody}>No weekly cap at your tier.</Text>
              )}
            </View>

            {/* "Reply within 30 min" nudge — ties to response_rate_7d / Quick Responder badge */}
            {response_nudge.show && (
              <View style={styles.nudge}>
                <Ionicons name="flash-outline" size={18} color={palette.warning} />
                <Text style={styles.nudgeText}>
                  Reply within 30 minutes to keep your response rate up — it feeds the Quick Responder badge.
                </Text>
              </View>
            )}

            {/* New / Scheduled tabs */}
            <SegmentedButtons
              value={tab}
              onValueChange={(v) => setTab(v as TabKey)}
              buttons={[
                { value: 'new',       label: `New (${newRequests.length})` },
                { value: 'scheduled', label: `Scheduled (${scheduled.length})` },
              ]}
              style={styles.segmented}
            />
          </View>
        )}
        renderItem={({ item }) => (
          <RequestCard
            entry={item}
            onPress={() => navigation.navigate('BookingDetail', { bookingId: item.booking_id })}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Ionicons name={tab === 'new' ? 'mail-open-outline' : 'calendar-outline'} size={40} color={palette.textDisabled} />
            <Text style={styles.emptyTitle}>{tab === 'new' ? 'No new requests' : 'Nothing scheduled'}</Text>
            <Text style={styles.emptyBody}>
              {tab === 'new'
                ? 'Funded bookings waiting for you to start will land here.'
                : 'Jobs you’ve started will show up here until they’re delivered.'}
            </Text>
          </View>
        )}
        ListFooterComponent={(
          <Text style={styles.footnote}>
            For your safety and the buyer’s privacy, full contact details unlock once a job is under way —
            we never show a customer’s raw risk score, only the hint above.
          </Text>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm, gap: 2 },
  title: { ...typography.heading2, color: palette.textPrimary },
  subtitle: { ...typography.bodySmall, color: palette.textSecondary },

  skeletons: { padding: spacing.lg, gap: spacing.md },
  skeleton: { height: 130, borderRadius: r.xl },

  list: { paddingHorizontal: spacing.lg },
  listHeader: { gap: spacing.md, paddingBottom: spacing.sm },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.xl,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    ...shadow.card,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { ...typography.label, color: palette.textSecondary },
  cardBody: { ...typography.bodySmall, color: palette.textSecondary, marginTop: 2 },
  weeklyValue: { ...typography.heading3, color: palette.primary },
  bar: { height: 6, borderRadius: 3, marginVertical: spacing.sm },

  nudge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: palette.warningLight, borderRadius: r.lg,
    padding: spacing.md,
  },
  nudgeText: { ...typography.bodySmall, color: palette.warning, flex: 1, lineHeight: 18 },

  segmented: {},

  // Request cards
  cardWrap: { borderRadius: r.xl },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  avatar: {
    width: 38, height: 38, borderRadius: r.full,
    backgroundColor: palette.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  buyerName: { ...typography.label, color: palette.textPrimary, fontSize: 14 },
  hintPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    borderRadius: r.full, paddingHorizontal: spacing.xs, paddingVertical: 2, marginTop: 3,
  },
  hintText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10.5 },
  timerPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  timerText: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 11 },

  serviceTitle: { ...typography.label, color: palette.textPrimary, fontSize: 15, marginBottom: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metaText: { ...typography.bodySmall, color: palette.textSecondary, flex: 1 },

  netRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  netText: { ...typography.bodySmall, color: palette.textSecondary, flex: 1 },
  netStrong: { fontFamily: 'PlusJakartaSans_700Bold', color: palette.success },
  quoteChip: { backgroundColor: palette.primaryLight, height: 24 },
  quoteChipText: { fontSize: 10, color: palette.primary, marginVertical: 0, lineHeight: 14 },

  escrowRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm,
    paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: palette.border,
  },
  escrowText: { ...typography.bodySmall, color: palette.success, fontSize: 12, flex: 1 },

  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.xs },
  emptyTitle: { ...typography.label, color: palette.textPrimary },
  emptyBody: { ...typography.bodySmall, color: palette.textSecondary, textAlign: 'center', paddingHorizontal: spacing.xl },

  footnote: {
    ...typography.bodySmall, color: palette.textDisabled, fontSize: 11.5,
    textAlign: 'center', lineHeight: 16, marginTop: spacing.lg, paddingHorizontal: spacing.md,
  },
});
