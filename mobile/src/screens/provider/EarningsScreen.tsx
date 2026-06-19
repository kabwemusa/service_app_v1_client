import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Chip, ProgressBar, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { EarningsEntry } from '../../api/providerProfile';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useProfileStore } from '../../store/profileStore';
import { palette, radius as r, spacing, typography } from '../../theme';

function payoutCountdown(eligibleAt: string | null): string {
  if (!eligibleAt) return 'Pending completion';
  const diff = new Date(eligibleAt).getTime() - Date.now();
  if (diff <= 0) return 'Ready now';
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(h / 24);
  if (d > 0) return `In ${d}d ${h % 24}h`;
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `In ${h}h ${m}m` : `In ${m}m`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function SummaryTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={[styles.card, styles.tile]}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      {!!hint && <Text style={styles.tileHint}>{hint}</Text>}
    </View>
  );
}

function CommissionRow({ entry }: { entry: EarningsEntry }) {
  return (
    <View style={styles.commissionRow}>
      <View style={[styles.commissionIcon, { backgroundColor: entry.paid ? palette.successLight : palette.warningLight }]}>
        <Ionicons
          name={entry.paid ? 'checkmark-circle-outline' : 'time-outline'}
          size={18}
          color={entry.paid ? palette.success : palette.warning}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.commissionTitle} numberOfLines={1}>{entry.service_title ?? 'Booking'}</Text>
        <Text style={styles.commissionMeta}>
          {formatDate(entry.calculated_at)} · ZMW {entry.gross_zmw.toFixed(0)} gross · {(entry.commission_rate * 100).toFixed(1)}% commission
        </Text>
        {!entry.paid && (
          <Text style={styles.commissionHold}>{payoutCountdown(entry.eligible_at)}</Text>
        )}
      </View>
      <View style={styles.commissionRight}>
        <Text style={styles.commissionNet}>+ZMW {entry.net_zmw.toFixed(0)}</Text>
        <Chip
          compact
          mode="flat"
          style={{ backgroundColor: entry.paid ? palette.successLight : palette.warningLight }}
          textStyle={{ fontSize: 10, color: entry.paid ? palette.success : palette.warning }}
        >
          {entry.paid ? 'Paid out' : 'On hold'}
        </Chip>
      </View>
    </View>
  );
}

export default function EarningsScreen({ navigation }: any) {
  const { earnings, loading, error, fetchEarnings, clearError } = useProfileStore();
  const { showError } = useSnackbar();
  const insets = useSafeAreaInsets();
  const showBack = navigation.canGoBack();

  useEffect(() => {
    fetchEarnings();
  }, []);

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const Header = () => (
    <ScreenHeader
      title="Earnings"
      subtitle="Weekly cap, earnings, and job history"
      back={showBack}
    />
  );

  if (loading && !earnings) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header />
        <View style={styles.skeletons}>
          {[1, 2, 3].map((key) => <CardSkeleton key={key} style={styles.skeleton} />)}
        </View>
      </SafeAreaView>
    );
  }

  if (!earnings) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header />
      </SafeAreaView>
    );
  }

  const { tier, summary, next_payout, instant_payout, recent } = earnings;
  const isDirect = earnings.payment_mode === 'DIRECT';
  const weeklyProgress = summary.weekly_cap_zmw ? Math.min(summary.this_week_zmw / summary.weekly_cap_zmw, 1) : 1;
  const feePct = (instant_payout.fee_rate * 100).toFixed(0);

  return (
    <SafeAreaView style={styles.safe}>
      <Header />
      <FlatList
        data={recent}
        keyExtractor={(item, index) => `${item.booking_id}-${index}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 120 }]}
        ListHeaderComponent={(
          <View style={styles.listHeader}>
            <View style={styles.tileRow}>
              <SummaryTile label={isDirect ? 'Paid to you this week' : 'This week'} value={`ZMW ${summary.this_week_zmw.toFixed(0)}`} hint={isDirect ? 'paid directly by customers' : (summary.weekly_cap_zmw != null ? `of ZMW ${summary.weekly_cap_zmw} cap` : 'No weekly cap')} />
              <SummaryTile label="This month" value={`ZMW ${summary.this_month_zmw.toFixed(0)}`} />
            </View>
            {summary.weekly_cap_zmw != null && (
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.sectionLabel}>Weekly cap usage</Text>
                  <Text style={styles.capPercent}>{Math.round(weeklyProgress * 100)}%</Text>
                </View>
                <ProgressBar progress={weeklyProgress} color={weeklyProgress >= 1 ? palette.warning : palette.success} style={styles.bar} />
                <Text style={styles.cardBody}>
                  Tier {tier.value} · {tier.label} caps you at ZMW {summary.weekly_cap_zmw}/week. Reach the next tier to raise it.
                </Text>
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Lifetime earnings</Text>
              <Text style={styles.lifetimeValue}>ZMW {summary.lifetime_zmw.toFixed(0)}</Text>
            </View>

            {isDirect ? (
              <View style={[styles.card, styles.instantRow]}>
                <View style={[styles.instantIcon, { backgroundColor: palette.successLight }]}>
                  <Ionicons name="cash-outline" size={20} color={palette.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Paid directly</Text>
                  <Text style={styles.cardBody}>
                    Customers pay you directly for each job — there are no platform payouts to wait for.
                  </Text>
                </View>
              </View>
            ) : (
              <>
                <View style={styles.card}>
                  <Text style={styles.sectionLabel}>Next payout</Text>
                  {next_payout ? (
                    <>
                      <Text style={styles.lifetimeValue}>ZMW {next_payout.amount_zmw.toFixed(0)}</Text>
                      <Text style={styles.cardBody}>{payoutCountdown(next_payout.eligible_at)} · {tier.payout_hold_hours}h hold after job completion</Text>
                    </>
                  ) : (
                    <Text style={styles.cardBody}>No payouts pending right now — completed jobs will appear here.</Text>
                  )}
                </View>

                <View style={[styles.card, styles.instantRow]}>
                  <View style={[styles.instantIcon, { backgroundColor: instant_payout.eligible ? palette.warningLight : palette.border }]}>
                    <Ionicons name="flash-outline" size={20} color={instant_payout.eligible ? palette.warning : palette.textDisabled} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>Instant payout</Text>
                    <Text style={styles.cardBody}>
                      {instant_payout.eligible
                        ? `Cash out completed jobs immediately for a ${feePct}% fee — skip the ${tier.payout_hold_hours}h hold.`
                        : `Reach Tier 3 to unlock instant payouts (${feePct}% fee, skips the standard hold).`}
                    </Text>
                  </View>
                  <Chip
                    compact
                    mode="flat"
                    style={{ backgroundColor: instant_payout.eligible ? palette.successLight : palette.border }}
                    textStyle={{ fontSize: 11, color: instant_payout.eligible ? palette.success : palette.textSecondary }}
                  >
                    {instant_payout.eligible ? 'Eligible' : 'Locked'}
                  </Chip>
                </View>
              </>
            )}

            <Text style={styles.sectionLabel}>{isDirect ? 'Recent jobs' : 'Recent commissions'}</Text>
          </View>
        )}
        renderItem={({ item }) => <CommissionRow entry={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={40} color={palette.textDisabled} />
            <Text style={styles.emptyTitle}>No commissions yet</Text>
            <Text style={styles.emptyBody}>Completed bookings will show up here with their commission breakdown.</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm, gap: spacing.md },
  backBtn: {
    width: 36, height: 36, borderRadius: r.full,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border,
  },
  backBtnPlaceholder: { width: 36, height: 36 },
  headerText: { flex: 1 },
  title: { ...typography.heading3, color: palette.textPrimary },
  subtitle: { ...typography.bodySmall, color: palette.textSecondary, marginTop: 2 },

  skeletons: { padding: spacing.lg, gap: spacing.md },
  skeleton: { height: 110, borderRadius: r.sm },

  list: { paddingHorizontal: spacing.lg },
  listHeader: { gap: spacing.md, paddingBottom: spacing.sm },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
  },
  cardTitle: { ...typography.label, color: palette.textPrimary, marginBottom: 2 },
  cardBody: { ...typography.bodySmall, color: palette.textSecondary, lineHeight: 18 },
  sectionLabel: { ...typography.label, color: palette.textSecondary, marginBottom: spacing.xs },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bar: { height: 6, borderRadius: 3, marginBottom: spacing.sm },
  capPercent: { ...typography.label, color: palette.textPrimary, fontSize: 13 },

  tileRow: { flexDirection: 'row', gap: spacing.md },
  tile: { flex: 1 },
  tileValue: { ...typography.heading3, color: palette.textPrimary, marginVertical: 2 },
  tileHint: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 11.5 },
  lifetimeValue: { ...typography.heading2, color: palette.primary, marginTop: 2 },

  instantRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  instantIcon: { width: 40, height: 40, borderRadius: r.full, alignItems: 'center', justifyContent: 'center' },

  // Commission list rows
  commissionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  commissionIcon: { width: 36, height: 36, borderRadius: r.full, alignItems: 'center', justifyContent: 'center' },
  commissionTitle: { ...typography.label, color: palette.textPrimary, fontSize: 14 },
  commissionMeta: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 11.5, marginTop: 1 },
  commissionHold: { ...typography.bodySmall, color: palette.warning, fontSize: 11.5, marginTop: 1 },
  commissionRight: { alignItems: 'flex-end', gap: 4 },
  commissionNet: { ...typography.label, color: palette.success, fontSize: 14 },
  separator: { height: 1, backgroundColor: palette.border, marginVertical: spacing.xs },

  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.xs },
  emptyTitle: { ...typography.label, color: palette.textPrimary },
  emptyBody: { ...typography.bodySmall, color: palette.textSecondary, textAlign: 'center', paddingHorizontal: spacing.xl },
});
