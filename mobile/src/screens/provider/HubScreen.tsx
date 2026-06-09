import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chip, Divider, ProgressBar, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { EARNED_BADGE_META } from '../../components/discovery/VettingBadge';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useProfileStore } from '../../store/profileStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const TIER_COLORS = [palette.textDisabled, palette.warning, palette.primary, palette.success, palette.secondary];

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

function CapStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.capStat}>
      <Text style={styles.capValue}>{value}</Text>
      <Text style={styles.capLabel}>{label}</Text>
    </View>
  );
}

interface ManageLinkProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  comingSoon?: boolean;
}

function ManageLink({ icon, label, onPress, comingSoon }: ManageLinkProps) {
  return (
    <TouchableRipple onPress={onPress} borderless style={styles.manageItem}>
      <View style={styles.manageItemInner}>
        <Ionicons name={icon} size={20} color={palette.textSecondary} />
        <Text style={styles.manageLabel}>{label}</Text>
        {comingSoon && (
          <Chip compact mode="flat" style={styles.soonChip} textStyle={styles.soonChipText}>
            Soon
          </Chip>
        )}
        <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
      </View>
    </TouchableRipple>
  );
}

export default function HubScreen({ navigation }: any) {
  const { dashboard, loading, error, fetchDashboard, clearError } = useProfileStore();
  const { showError, showSnackbar } = useSnackbar();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    fetchDashboard();
  }, []);

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  if (loading && !dashboard) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.scroll}>
          {[1, 2, 3, 4].map((key) => <CardSkeleton key={key} style={styles.skeleton} />)}
        </View>
      </SafeAreaView>
    );
  }

  if (!dashboard) {
    return <SafeAreaView style={styles.safe} />;
  }

  const { tier, next_tier, profile_completeness, checklist, earned_badges, earnings, next_payout, instant_payout } = dashboard;
  const tierColor = TIER_COLORS[tier.value] ?? palette.primary;
  const weeklyProgress = earnings.weekly_cap_zmw ? Math.min(earnings.this_week_zmw / earnings.weekly_cap_zmw, 1) : 1;
  const feePct = (instant_payout.fee_rate * 100).toFixed(0);

  const handleGrowPress = () => {
    showSnackbar({ message: "Promotion plans are coming soon — we'll let you know when Grow launches." });
  };

  const checklistNav: Partial<Record<string, () => void>> = {
    profile_photo:       () => navigation.navigate('ProviderProfileEdit'),
    bio:                 () => navigation.navigate('ProviderProfileEdit'),
    portfolio_image:     () => navigation.navigate('ProviderProfileEdit'),
    three_services:      () => navigation.navigate('Services'),
    weekly_availability: () => navigation.navigate('ProviderSetup'),
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
      >
        <Text style={styles.heading}>Business Hub</Text>
        <Text style={styles.sub}>Everything you need to run your Sebenza business, in one place.</Text>

        {/* Tier card */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.sectionLabel}>Your tier</Text>
              <Text style={[styles.tierName, { color: tierColor }]}>{tier.label}</Text>
            </View>
            <View style={[styles.tierBadge, { borderColor: tierColor }]}>
              <Text style={[styles.tierBadgeText, { color: tierColor }]}>Tier {tier.value}</Text>
            </View>
          </View>
          <ProgressBar progress={tier.value / 4} color={tierColor} style={styles.bar} />
          <View style={styles.capRow}>
            <CapStat label="Job cap" value={tier.job_cap_zmw != null ? `ZMW ${tier.job_cap_zmw}` : 'No cap'} />
            <CapStat label="Weekly cap" value={tier.weekly_cap_zmw != null ? `ZMW ${tier.weekly_cap_zmw}` : 'No cap'} />
            <CapStat label="Payout hold" value={`${tier.payout_hold_hours}h`} />
          </View>
        </View>

        {/* Profile-strength meter + §9.1 checklist */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionLabel}>Profile strength</Text>
            <Text style={styles.strengthValue}>{profile_completeness}%</Text>
          </View>
          <ProgressBar progress={profile_completeness / 100} color={palette.primary} style={styles.bar} />

          {checklist.next && (
            <View style={styles.nextBanner}>
              <Ionicons name="arrow-forward-circle-outline" size={18} color={palette.primary} />
              <Text style={styles.nextBannerText}>
                Next up: <Text style={styles.nextBannerStrong}>{checklist.next.label}</Text> · +{checklist.next.points} pts
              </Text>
            </View>
          )}

          <View style={styles.checklist}>
            {checklist.items.map((item) => {
              const action = !item.done ? checklistNav[item.key] : undefined;
              const inner = (
                <View style={styles.checklistRow}>
                  <Ionicons
                    name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={item.done ? palette.success : palette.textDisabled}
                  />
                  <Text style={[styles.checklistLabel, item.done && styles.checklistLabelDone]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {action
                    ? <Ionicons name="chevron-forward" size={14} color={palette.primary} />
                    : <Text style={styles.checklistPoints}>+{item.points}</Text>
                  }
                </View>
              );
              return action ? (
                <TouchableRipple key={item.key} onPress={action} style={styles.checklistRipple}>
                  {inner}
                </TouchableRipple>
              ) : (
                <View key={item.key}>{inner}</View>
              );
            })}
          </View>
        </View>

        {/* Unlock next tier */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>
            {next_tier ? `Unlock ${next_tier.label}` : "You've reached the top tier"}
          </Text>
          {next_tier ? (
            <View style={styles.reqList}>
              {next_tier.requirements.map((req, i) => (
                <View key={i} style={styles.reqRow}>
                  <View style={styles.reqDot} />
                  <Text style={styles.reqText}>{req}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.cardBody}>
              You're a Professional provider — Sebenza's highest trust tier. Keep your record clean and your
              clients happy to stay there.
            </Text>
          )}
        </View>

        {/* Earnings + next payout tiles */}
        <View style={styles.tileRow}>
          <View style={[styles.card, styles.tile]}>
            <Text style={styles.sectionLabel}>This week</Text>
            <Text style={styles.tileValue}>ZMW {earnings.this_week_zmw.toFixed(0)}</Text>
            {earnings.weekly_cap_zmw != null ? (
              <>
                <ProgressBar progress={weeklyProgress} color={palette.success} style={styles.tileBar} />
                <Text style={styles.tileHint}>of ZMW {earnings.weekly_cap_zmw} weekly cap</Text>
              </>
            ) : (
              <Text style={styles.tileHint}>No weekly cap at your tier.</Text>
            )}
          </View>
          <View style={[styles.card, styles.tile]}>
            <Text style={styles.sectionLabel}>Next payout</Text>
            {next_payout ? (
              <>
                <Text style={styles.tileValue}>ZMW {next_payout.amount_zmw.toFixed(0)}</Text>
                <Text style={styles.tileHint}>{payoutCountdown(next_payout.eligible_at)}</Text>
              </>
            ) : (
              <>
                <Text style={styles.tileValue}>—</Text>
                <Text style={styles.tileHint}>No payouts pending.</Text>
              </>
            )}
          </View>
        </View>

        {/* Instant payout row — Tier 3+, 1% fee */}
        <View style={[styles.card, styles.instantRow]}>
          <View style={[styles.instantIcon, { backgroundColor: instant_payout.eligible ? palette.warningLight : palette.border }]}>
            <Ionicons name="flash-outline" size={20} color={instant_payout.eligible ? palette.warning : palette.textDisabled} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Instant payout</Text>
            <Text style={styles.cardBody}>
              {instant_payout.eligible
                ? `Skip the wait — cash out completed jobs straight away for a ${feePct}% fee.`
                : `Reach Tier 3 to unlock instant payouts on completed jobs (${feePct}% fee).`}
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

        {/* Earned badges */}
        {earned_badges.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Your badges</Text>
            <View style={styles.badgeRow}>
              {earned_badges.map((key) => {
                const meta = EARNED_BADGE_META[key];
                if (!meta) return null;
                return (
                  <View key={key} style={[styles.badgeChip, { borderColor: meta.color }]}>
                    <Ionicons name={meta.icon} size={13} color={meta.color} />
                    <Text style={[styles.badgeChipText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Manage links */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Manage</Text>
          <View style={styles.card}>
            <ManageLink
              icon="person-circle-outline"
              label="Profile & highlights"
              onPress={() => navigation.navigate('ProviderProfileEdit')}
            />
            <Divider />
            <ManageLink
              icon="construct-outline"
              label="Services"
              onPress={() => navigation.navigate('Services')}
            />
            <Divider />
            <ManageLink
              icon="calendar-outline"
              label="Availability"
              onPress={() => navigation.navigate('ProviderSetup')}
            />
            <Divider />
            <ManageLink
              icon="cash-outline"
              label="Earnings & analytics"
              onPress={() => navigation.navigate('Earnings')}
            />
            <Divider />
            <ManageLink icon="trending-up-outline" label="Grow" comingSoon onPress={handleGrowPress} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { padding: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  skeleton: { marginBottom: spacing.md, height: 120, borderRadius: r.xl },

  heading: { ...typography.heading2, color: palette.textPrimary, marginBottom: 2 },
  sub: { ...typography.body, color: palette.textSecondary, marginBottom: spacing.xs },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.xl,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    ...shadow.card,
  },
  section: { gap: spacing.sm },
  sectionLabel: { ...typography.label, color: palette.textSecondary },
  cardTitle: { ...typography.label, color: palette.textPrimary, marginBottom: 2 },
  cardBody: { ...typography.bodySmall, color: palette.textSecondary, lineHeight: 18 },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  bar: { height: 6, borderRadius: 3, marginBottom: spacing.md },

  // Tier card
  tierName: { ...typography.heading3, marginTop: 2 },
  tierBadge: { borderWidth: 1.5, borderRadius: r.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  tierBadgeText: { ...typography.label, fontSize: 12 },
  capRow: { flexDirection: 'row', justifyContent: 'space-between' },
  capStat: { alignItems: 'center', flex: 1, gap: 2 },
  capValue: { ...typography.label, color: palette.textPrimary, fontSize: 14 },
  capLabel: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 11 },

  // Profile strength
  strengthValue: { ...typography.heading3, color: palette.primary },
  nextBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: palette.primaryLight, borderRadius: r.lg,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, marginBottom: spacing.md,
  },
  nextBannerText: { ...typography.bodySmall, color: palette.primary, flex: 1 },
  nextBannerStrong: { fontFamily: 'PlusJakartaSans_600SemiBold' },
  checklist: { gap: spacing.sm },
  checklistRipple: { borderRadius: r.md },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checklistLabel: { ...typography.bodySmall, color: palette.textPrimary, flex: 1 },
  checklistLabelDone: { color: palette.textSecondary, textDecorationLine: 'line-through' },
  checklistPoints: { ...typography.bodySmall, color: palette.textDisabled, fontSize: 12 },

  // Unlock next tier
  reqList: { gap: spacing.xs, marginTop: spacing.xs },
  reqRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  reqDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.primary, marginTop: 6 },
  reqText: { ...typography.bodySmall, color: palette.textSecondary, flex: 1, lineHeight: 18 },

  // Earnings tiles
  tileRow: { flexDirection: 'row', gap: spacing.md },
  tile: { flex: 1 },
  tileValue: { ...typography.heading3, color: palette.textPrimary, marginVertical: 2 },
  tileBar: { height: 5, borderRadius: 3, marginTop: spacing.xs, marginBottom: 4 },
  tileHint: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 11.5 },

  // Instant payout row
  instantRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  instantIcon: { width: 40, height: 40, borderRadius: r.full, alignItems: 'center', justifyContent: 'center' },

  // Badges
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badgeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderRadius: r.full, paddingHorizontal: spacing.sm, paddingVertical: 5,
  },
  badgeChipText: { ...typography.label, fontSize: 11.5 },

  // Manage links
  manageItem: {},
  manageItemInner: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md },
  manageLabel: { ...typography.body, color: palette.textPrimary, flex: 1 },
  soonChip: { backgroundColor: palette.warningLight, height: 24 },
  soonChipText: { fontSize: 10, color: palette.warning, marginVertical: 0, lineHeight: 14 },
});
