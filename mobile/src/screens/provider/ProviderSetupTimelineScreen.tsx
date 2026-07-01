import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback } from 'react';
import {
  ScrollView,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { ProgressBar, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Divider } from '../../components/ui/Card';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useProfileStore } from '../../store/profileStore';
import { palette, radius as r, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type StepState = 'done' | 'current' | 'upcoming' | 'locked';

// ── Dark/light theme (mirrors HubScreen) ─────────────────────────────────────
type ThemeC = { bg: string; surface: string; border: string; t1: string; t2: string; t3: string };
const DARK: ThemeC = { bg: '#0F0A0D', surface: '#1C1015', border: '#3A2030', t1: '#F5E8EE', t2: '#C79BB0', t3: '#7C5868' };
const LIGHT: ThemeC = {
  bg: palette.background,
  surface: palette.surface,
  border: palette.border,
  t1: palette.textPrimary,
  t2: palette.textSecondary,
  t3: palette.textDisabled,
};

// ── The six milestones, in the exact onboarding order ────────────────────────
// Service (3) is deliberately BEFORE identity (4): build investment before the
// heavy ask. Each milestone routes into an EXISTING screen — nothing rebuilt.
type MilestoneKey = 'account' | 'profile' | 'service' | 'identity' | 'payment' | 'golive';

interface Milestone {
  key: MilestoneKey;
  num: number;
  icon: IconName;
  title: string;
  sub: string;
  /** Destination screen + the step number passed so it shows the progress bar. */
  route?: { name: string; step: number };
}

const MILESTONES: Milestone[] = [
  { key: 'account',  num: 1, icon: 'call-outline',           title: 'Create account',   sub: 'Phone number verified' },
  { key: 'profile',  num: 2, icon: 'person-circle-outline',  title: 'Your profile',     sub: 'Name, photo, area & languages', route: { name: 'ProviderProfileEdit', step: 2 } },
  { key: 'service',  num: 3, icon: 'construct-outline',      title: 'Add your service', sub: 'Category, price & availability', route: { name: 'CreateService', step: 3 } },
  { key: 'identity', num: 4, icon: 'shield-checkmark-outline', title: 'Verify identity', sub: 'NRC + selfie · Tier 1',        route: { name: 'Kyc', step: 4 } },
  { key: 'payment',  num: 5, icon: 'cash-outline',           title: 'Payment details',  sub: 'Mobile-money payout number',    route: { name: 'ProviderSetup', step: 5 } },
  { key: 'golive',   num: 6, icon: 'rocket-outline',         title: 'Go live',          sub: 'Review & start getting booked' },
];

export default function ProviderSetupTimelineScreen({ navigation }: any) {
  const { profile, dashboard, loading, fetchProfile, fetchDashboard } = useProfileStore();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? DARK : LIGHT;

  // Refresh on every focus so returning from a step reflects new progress
  // immediately (resumability — the provider always sees their true position).
  useFocusEffect(
    useCallback(() => {
      fetchProfile();
      fetchDashboard();
    }, [])
  );

  const listing = dashboard?.listing;
  const stepDone = (key: string) => listing?.steps.find((s) => s.key === key)?.done ?? false;

  // Milestone completion — derived purely from existing store data; the three
  // server gates (mirrored here) plus the MoMo fields already on the profile.
  const done: Record<MilestoneKey, boolean> = {
    account: true, // authenticated providers have a verified phone by definition
    profile: stepDone('profile_strength'),
    service: stepDone('active_service'),
    identity: stepDone('verify_identity') || (profile?.trust_tier ?? 0) >= 1,
    payment: !!profile?.momo_number && !!profile?.momo_provider,
    golive: listing?.listed ?? false,
  };

  const prereqDone = done.account && done.profile && done.service && done.identity && done.payment;
  const order: MilestoneKey[] = ['account', 'profile', 'service', 'identity', 'payment', 'golive'];
  const firstIncomplete = order.find((k) => !done[k]);
  const doneCount = order.filter((k) => done[k]).length;

  const stateFor = (key: MilestoneKey): StepState => {
    if (done[key]) return 'done';
    if (key === 'golive') return prereqDone ? 'current' : 'locked';
    return key === firstIncomplete ? 'current' : 'upcoming';
  };

  const goToStep = (m: Milestone) => {
    if (m.route) navigation.navigate(m.route.name, { onboardingStep: m.route.step });
  };

  // Once setup is complete the provider is listed (the three server gates are a
  // subset of milestones 2–4), so "going live" simply makes the Hub their home.
  const handleGoLive = () => navigation.replace('HubMain');

  const handleRowPress = (m: Milestone, state: StepState) => {
    if (m.key === 'account') return; // nothing to open — phone is already verified
    if (m.key === 'golive') {
      if (state === 'locked') return; // hint shown inline; the steps above gate it
      handleGoLive();
      return;
    }
    goToStep(m);
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading && !dashboard) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
        <ScreenHeader title="Set up your account" />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {[1, 2, 3].map((k) => (
            <CardSkeleton key={k} style={{ height: 72, borderRadius: r.sm }} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  const isLive = done.golive;
  const ctaLabel = isLive
    ? 'Go to your Hub'
    : firstIncomplete === 'golive'
    ? 'Go live'
    : 'Continue setup';
  const ctaTarget = () => {
    if (isLive || firstIncomplete === 'golive') {
      handleGoLive();
      return;
    }
    const m = MILESTONES.find((x) => x.key === firstIncomplete);
    if (m) goToStep(m);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <ScreenHeader title="Set up your account" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
      >
        {/* ── Progress summary ── */}
        <Card style={{ ...cardStyle(c) }}>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryTitle, { color: c.t1 }]}>
              {isLive ? "You're live" : "You're almost there"}
            </Text>
            <Text style={styles.summaryCount}>{doneCount} of 6 done</Text>
          </View>
          <ProgressBar
            progress={doneCount / 6}
            color={isLive ? palette.success : palette.primary}
            style={[styles.summaryBar, { backgroundColor: c.border }]}
          />
          <Text style={[styles.summarySub, { color: c.t2 }]}>
            {isLive
              ? 'Customers can find and book you. You can still edit any step below.'
              : 'Finish each step in order. You can leave and come back any time — you’ll pick up right where you left off.'}
          </Text>
        </Card>

        {/* ── Vertical timeline ── */}
        <Card padding={0} style={{ ...cardStyle(c), marginTop: spacing.md }}>
          {MILESTONES.map((m, i) => {
            const state = stateFor(m.key);
            const last = i === MILESTONES.length - 1;
            return (
              <TimelineRow
                key={m.key}
                m={m}
                state={state}
                last={last}
                connectorDone={done[m.key]}
                c={c}
                onPress={() => handleRowPress(m, state)}
                onGoLive={handleGoLive}
              />
            );
          })}
        </Card>

        {/* ── Post-go-live, non-blocking tier unlock ── */}
        {prereqDone && dashboard?.next_tier && (
          <Card style={{ ...cardStyle(c), marginTop: spacing.md }}>
            <View style={styles.unlockHead}>
              <Ionicons name="ribbon-outline" size={18} color={palette.warning} />
              <Text style={[styles.unlockTitle, { color: c.t1 }]}>
                Unlock {dashboard.next_tier.label} (optional)
              </Text>
            </View>
            <Text style={[styles.unlockBody, { color: c.t2 }]}>
              You’re cleared to go live now. Some categories need a higher tier to take
              bookings — you can upgrade now or later. It won’t hold up going live.
            </Text>
            <TouchableRipple
              onPress={() => navigation.navigate('Kyc')}
              borderless
              accessibilityRole="button"
              accessibilityLabel={`Verify for ${dashboard.next_tier.label}`}
              style={styles.unlockBtn}
            >
              <View style={styles.unlockBtnInner}>
                <Text style={styles.unlockBtnText}>Verify for {dashboard.next_tier.label}</Text>
                <Ionicons name="arrow-forward" size={15} color={palette.primary} />
              </View>
            </TouchableRipple>
          </Card>
        )}
      </ScrollView>

      {/* ── Sticky resume CTA ── */}
      <View
        style={[
          styles.ctaBar,
          { backgroundColor: c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + spacing.sm },
        ]}
      >
        <TouchableRipple
          onPress={ctaTarget}
          borderless
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={[styles.ctaBtn, isLive && { backgroundColor: palette.success }]}
        >
          <View style={styles.ctaInner}>
            <Text style={styles.ctaText}>{ctaLabel}</Text>
            <Ionicons
              name={isLive ? 'arrow-forward' : 'arrow-forward-circle'}
              size={18}
              color="#fff"
            />
          </View>
        </TouchableRipple>
      </View>
    </SafeAreaView>
  );
}

// ── Timeline row ─────────────────────────────────────────────────────────────
function TimelineRow({
  m,
  state,
  last,
  connectorDone,
  c,
  onPress,
  onGoLive,
}: {
  m: Milestone;
  state: StepState;
  last: boolean;
  connectorDone: boolean;
  c: ThemeC;
  onPress: () => void;
  onGoLive: () => void;
}) {
  const isGoLiveCurrent = m.key === 'golive' && state === 'current';
  const tappable = m.key !== 'account' && !(m.key === 'golive' && state === 'locked');

  const node = (() => {
    switch (state) {
      case 'done':
        return { bg: palette.successLight, fg: palette.success, icon: 'checkmark' as IconName };
      case 'current':
        return { bg: palette.primaryLight, fg: palette.primary, icon: null };
      case 'locked':
        return { bg: c.border, fg: c.t3, icon: 'lock-closed' as IconName };
      default:
        return { bg: c.border, fg: c.t3, icon: null };
    }
  })();

  const chip =
    state === 'current'
      ? { label: m.key === 'golive' ? 'Ready' : "You're here", color: palette.primary, bg: palette.primaryLight }
      : state === 'done'
      ? { label: 'Done', color: palette.success, bg: palette.successLight }
      : state === 'locked'
      ? { label: 'Locked', color: c.t3, bg: c.border }
      : null;

  return (
    <TouchableRipple
      onPress={onPress}
      disabled={!tappable}
      borderless
      accessibilityRole="button"
      accessibilityState={{ disabled: !tappable }}
      accessibilityLabel={`Step ${m.num}, ${m.title}. ${
        state === 'done' ? 'Done' : state === 'current' ? "You're here" : state === 'locked' ? 'Locked' : 'Upcoming'
      }`}
    >
      <View style={styles.row}>
        {/* Rail: node + connector */}
        <View style={styles.rail}>
          <View style={[styles.node, { backgroundColor: node.bg }]}>
            {node.icon ? (
              <Ionicons name={node.icon} size={16} color={node.fg} />
            ) : (
              <Text style={[styles.nodeNum, { color: node.fg }]}>{m.num}</Text>
            )}
          </View>
          {!last && (
            <View
              style={[
                styles.connector,
                { backgroundColor: connectorDone ? palette.success : c.border },
              ]}
            />
          )}
        </View>

        {/* Content */}
        <View style={styles.rowContent}>
          <View style={styles.rowTop}>
            <Text
              style={[
                styles.rowTitle,
                { color: state === 'upcoming' || state === 'locked' ? c.t2 : c.t1 },
              ]}
              numberOfLines={1}
            >
              {m.title}
            </Text>
            {chip && (
              <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                <Text style={[styles.chipText, { color: chip.color }]}>{chip.label}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.rowSub, { color: c.t3 }]} numberOfLines={1}>
            {m.key === 'golive' && state === 'locked' ? 'Finish the steps above to go live' : m.sub}
          </Text>

          {isGoLiveCurrent && (
            <TouchableRipple
              onPress={onGoLive}
              borderless
              accessibilityRole="button"
              accessibilityLabel="Go live now"
              style={styles.goLiveBtn}
            >
              <View style={styles.goLiveInner}>
                <Ionicons name="rocket" size={15} color="#fff" />
                <Text style={styles.goLiveText}>Go live now</Text>
              </View>
            </TouchableRipple>
          )}
        </View>

        {tappable && (
          <Ionicons name="chevron-forward" size={16} color={c.t3} style={styles.chevron} />
        )}
      </View>
    </TouchableRipple>
  );
}

const cardStyle = (c: ThemeC) => ({
  backgroundColor: c.surface,
  borderColor: c.border,
  marginHorizontal: spacing.lg,
});

const NODE = 32;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingTop: spacing.md },

  // Summary
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  summaryTitle: { ...typography.heading3, fontSize: 17 },
  summaryCount: { fontFamily: 'DMSans_600SemiBold', fontSize: 14, color: palette.primary },
  summaryBar: { height: 8, borderRadius: r.full },
  summarySub: { ...typography.bodySmall, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },

  // Rows
  row: { flexDirection: 'row', paddingHorizontal: spacing.md, minHeight: 72 },
  rail: { width: NODE, alignItems: 'center' },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  nodeNum: { fontFamily: 'DMSans_600SemiBold', fontSize: 14 },
  connector: { width: 2, flex: 1, marginTop: 2, marginBottom: -spacing.md, borderRadius: 1 },

  rowContent: { flex: 1, paddingVertical: spacing.md, paddingLeft: spacing.md, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 15, flexShrink: 1 },
  rowSub: { ...typography.bodySmall, fontSize: 12 },
  chip: { borderRadius: r.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  chipText: { fontFamily: 'DMSans_500Medium', fontSize: 11 },
  chevron: { alignSelf: 'center' },

  goLiveBtn: { alignSelf: 'flex-start', marginTop: spacing.sm, borderRadius: r.sm, backgroundColor: palette.primary },
  goLiveInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  goLiveText: { fontFamily: 'DMSans_600SemiBold', fontSize: 13, color: '#fff' },

  // Tier unlock
  unlockHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  unlockTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 15 },
  unlockBody: { ...typography.bodySmall, fontSize: 13, lineHeight: 19 },
  unlockBtn: { alignSelf: 'flex-start', marginTop: spacing.sm },
  unlockBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  unlockBtnText: { ...typography.label, color: palette.primary, fontSize: 13 },

  // Sticky CTA
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ctaBtn: { borderRadius: r.sm, backgroundColor: palette.primary },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 52,
  },
  ctaText: { fontFamily: 'DMSans_600SemiBold', fontSize: 16, color: '#fff' },
});
