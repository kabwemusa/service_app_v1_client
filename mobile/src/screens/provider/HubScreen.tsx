import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { Chip, Divider, ProgressBar, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { EARNED_BADGE_META, VettingBadge } from '../../components/discovery/VettingBadge';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useProfileStore } from '../../store/profileStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ── Colour scheme ─────────────────────────────────────────────────────────────

const DARK = {
  bg:      '#0F0A0D',
  surface: '#1C1015',
  border:  '#3A2030',
  t1:      '#F5E8EE',
  t2:      '#B07090',
  t3:      '#604050',
} as const;

const LIGHT = {
  bg:      palette.background,
  surface: palette.surface,
  border:  palette.border,
  t1:      palette.textPrimary,
  t2:      palette.textSecondary,
  t3:      palette.textDisabled,
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

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

function pad(n: number) { return String(n).padStart(2, '0'); }
function formatJobTime(iso: string): string {
  const d   = new Date(iso);
  const now = new Date();
  const tom = new Date(now.getTime() + 86_400_000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const same  = (a: Date, b: Date) => a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (same(d, now)) return `Today · ${time}`;
  if (same(d, tom)) return `Tomorrow · ${time}`;
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONS[d.getMonth()]} · ${time}`;
}

function fmtRate(v: number | null | undefined): string {
  return v != null ? `${(v * 100).toFixed(0)}%` : '–';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProviderAvatar({ uri, name, size = 52 }: { uri?: string | null; name?: string | null; size?: number }) {
  const [imgErr, setImgErr] = useState(false);
  if (uri && !imgErr) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.border }}
        onError={() => setImgErr(true)}
        accessibilityRole="image"
        accessibilityLabel="Profile photo"
      />
    );
  }
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.primaryLight, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="image"
      accessibilityLabel={`Avatar: ${initials(name)}`}
    >
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: size * 0.36, color: palette.primary }}>
        {initials(name)}
      </Text>
    </View>
  );
}

function StatTile({ icon, value, label, t1, t2 }: { icon: IconName; value: string; label: string; t1: string; t2: string }) {
  return (
    <View style={styles.statTile} accessibilityLabel={`${label}: ${value}`}>
      <Ionicons name={icon} size={18} color={palette.primary} />
      <Text style={[styles.statValue, { color: t1 }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: t2 }]}>{label}</Text>
    </View>
  );
}

function ManageLink({ icon, label, onPress, t1, t2, t3 }: { icon: IconName; label: string; onPress: () => void; t1: string; t2: string; t3: string }) {
  return (
    <TouchableRipple
      onPress={onPress}
      borderless
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.manageRipple}
    >
      <View style={styles.manageRow}>
        <Ionicons name={icon} size={20} color={t2} />
        <Text style={[styles.manageLabel, { color: t1 }]}>{label}</Text>
        <Ionicons name="chevron-forward" size={16} color={t3} />
      </View>
    </TouchableRipple>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HubScreen({ navigation }: any) {
  const { dashboard, loading, error, fetchDashboard, clearError, toggleAcceptingBookings } = useProfileStore();
  const { showError, showSnackbar } = useSnackbar();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const C = scheme === 'dark' ? DARK : LIGHT;

  const [toggling, setToggling] = useState(false);

  useEffect(() => { fetchDashboard(); }, []);
  useEffect(() => { if (error) { showError(error.message); clearError(); } }, [error]);

  const handleAvailToggle = useCallback(async (val: boolean) => {
    setToggling(true);
    try { await toggleAcceptingBookings(val); }
    finally { setToggling(false); }
  }, [toggleAcceptingBookings]);

  const soon = (what: string) => () =>
    showSnackbar({ message: `${what} is coming soon — we'll let you know when it launches.` });

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading && !dashboard) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]}>
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {[1, 2, 3, 4].map(k => (
            <CardSkeleton key={k} style={{ height: 120, borderRadius: r.xl }} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (!dashboard) {
    return <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]} />;
  }

  // ── Destructure dashboard ─────────────────────────────────────────────────
  const {
    tier, next_tier,
    profile_completeness, checklist,
    listing,
    earned_badges = [],
    earnings, next_payout, instant_payout,
    accepting_bookings = true,
    profile_photo_url   = null,
    display_name        = null,
    notifications_count = 0,
    today,
    stats,
    subscription,
  } = dashboard;

  const isDirect       = dashboard.payment_mode === 'DIRECT';
  const isNewProvider  = (stats?.jobs_done ?? 0) === 0;
  const tierColor      = [palette.textDisabled, palette.warning, palette.primary, palette.success, palette.warning][tier.value] ?? palette.primary;
  const weeklyProg     = earnings.weekly_cap_zmw ? Math.min(earnings.this_week_zmw / earnings.weekly_cap_zmw, 1) : 1;
  const feePct         = ((instant_payout.fee_rate ?? 0.01) * 100).toFixed(0);
  const currentPlan    = subscription?.plan ?? 'FREE';
  const newReqs        = today?.new_requests ?? 0;

  // Shared card style — background + border adapt to dark/light mode
  const cardStyle: import('react-native').StyleProp<import('react-native').ViewStyle> = [
    styles.card, { backgroundColor: C.surface, borderColor: C.border },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: C.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
      >

        {/* ── 1. HEADER ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <ProviderAvatar uri={profile_photo_url} name={display_name} size={52} />
            <View style={styles.headerMeta}>
              <Text style={[styles.headerName, { color: C.t1 }]} numberOfLines={1}>
                {display_name ?? 'Provider'}
              </Text>
              <VettingBadge trustTier={tier.value} size="sm" />
            </View>
          </View>

          <View style={styles.headerRight}>
            {/* Notifications */}
            <TouchableOpacity
              onPress={soon('Notifications')}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel={notifications_count > 0 ? `${notifications_count} notifications` : 'Notifications'}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="notifications-outline" size={22} color={C.t2} />
              {notifications_count > 0 && (
                <View style={styles.notifDot}>
                  <Text style={styles.notifDotText}>{notifications_count > 9 ? '9+' : notifications_count}</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Available / Away toggle */}
            <View style={styles.availRow}>
              <Text style={[styles.availLabel, { color: accepting_bookings ? palette.success : C.t3 }]}>
                {accepting_bookings ? 'Available' : 'Away'}
              </Text>
              <Switch
                value={accepting_bookings}
                onValueChange={handleAvailToggle}
                disabled={toggling}
                trackColor={{ false: C.border, true: palette.successLight }}
                thumbColor={accepting_bookings ? palette.success : C.t3}
                accessibilityRole="switch"
                accessibilityLabel="Availability status — Away stops new booking requests"
                accessibilityState={{ checked: accepting_bookings, disabled: toggling }}
              />
            </View>
          </View>
        </View>

        {/* ── 1b. GET LISTED — ordered path to appearing in search ───────── */}
        {listing && !listing.listed && (
          <View style={cardStyle}>
            <Text style={[styles.sectionLabel, { color: C.t2 }]}>Get listed in search</Text>
            <Text style={[styles.hint, { color: C.t2, marginBottom: spacing.xs }]}>
              Finish these steps in order — once all three are done, customers can find you.
            </Text>
            {listing.steps.map((step, i) => {
              const stepDest: Record<string, string> = {
                verify_identity: 'Kyc',
                profile_strength: 'ProviderProfileEdit',
                active_service: 'Services',
              };
              const isNext = !step.done && listing.steps.slice(0, i).every(s => s.done);
              return (
                <TouchableRipple
                  key={step.key}
                  onPress={() => navigation.navigate(stepDest[step.key] ?? 'ProviderProfileEdit')}
                  disabled={step.done}
                  borderless
                  accessibilityRole="button"
                  accessibilityLabel={`Step ${i + 1}: ${step.label}${step.done ? ' — done' : ''}`}
                  style={styles.listingRipple}
                >
                  <View style={styles.listingRow}>
                    <View style={[
                      styles.listingStepDot,
                      { backgroundColor: step.done ? palette.successLight : isNext ? palette.primaryLight : C.border },
                    ]}>
                      {step.done ? (
                        <Ionicons name="checkmark" size={14} color={palette.success} />
                      ) : (
                        <Text style={[styles.listingStepNum, { color: isNext ? palette.primary : C.t3 }]}>{i + 1}</Text>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.listingLabel,
                        { color: step.done ? C.t3 : C.t1 },
                        step.done && { textDecorationLine: 'line-through' },
                      ]}
                    >
                      {step.label}
                    </Text>
                    {!step.done && <Ionicons name="chevron-forward" size={16} color={C.t3} />}
                  </View>
                </TouchableRipple>
              );
            })}
          </View>
        )}
        {listing?.listed && (
          <View style={[styles.liveBanner, { borderColor: palette.success }]}>
            <Ionicons name="radio-outline" size={16} color={palette.success} />
            <Text style={[styles.liveBannerText, { color: palette.success }]}>
              You're live — customers can find you in search
            </Text>
          </View>
        )}

        {/* ── 2. EARNINGS ───────────────────────────────────────────────── */}
        <View style={cardStyle}>
          {isNewProvider ? (
            /* New-provider state: first-booking guidance */
            <>
              <Text style={[styles.sectionLabel, { color: C.t2 }]}>Earnings</Text>
              <Text style={[styles.emptyHeading, { color: C.t1 }]}>Ready for your first booking</Text>
              <Text style={[styles.emptyBody, { color: C.t2 }]}>
                Complete your profile and list your services — your weekly earnings will appear here once you take on work.
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('ProviderProfileEdit')}
                style={styles.emptyAction}
                accessibilityRole="button"
                accessibilityLabel="Complete your profile"
              >
                <Text style={styles.emptyActionText}>Complete your profile</Text>
                <Ionicons name="arrow-forward" size={14} color={palette.primary} />
              </TouchableOpacity>
            </>
          ) : (
            /* Normal earnings view */
            <>
              <View style={styles.rowBetween}>
                <Text style={[styles.sectionLabel, { color: C.t2 }]}>{isDirect ? 'Paid to you this week' : 'This week'}</Text>
                {earnings.trend && earnings.trend !== 'flat' && (
                  <Ionicons
                    name={earnings.trend === 'up' ? 'trending-up-outline' : 'trending-down-outline'}
                    size={18}
                    color={earnings.trend === 'up' ? palette.success : palette.danger}
                    accessibilityLabel={earnings.trend === 'up' ? 'Earnings up from last week' : 'Earnings down from last week'}
                  />
                )}
              </View>
              <Text style={[styles.earningsAmount, { color: C.t1 }]}>
                ZMW {earnings.this_week_zmw.toFixed(0)}
              </Text>
              {earnings.weekly_cap_zmw != null && (
                <>
                  <ProgressBar progress={weeklyProg} color={palette.success} style={styles.bar} />
                  <Text style={[styles.hint, { color: C.t3 }]}>
                    of ZMW {earnings.weekly_cap_zmw.toLocaleString()} weekly cap
                  </Text>
                </>
              )}

              {isDirect ? (
                <>
                  <Divider style={{ backgroundColor: C.border, marginVertical: spacing.sm }} />
                  <View style={styles.rowBetween}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                      <Ionicons name="cash-outline" size={14} color={palette.success} />
                      <Text style={[styles.hint, { color: C.t3, flex: 1 }]}>
                        Customers pay you directly — no payouts to wait for.
                      </Text>
                    </View>
                  </View>
                </>
              ) : (
                <>
                  <Divider style={{ backgroundColor: C.border, marginVertical: spacing.sm }} />

                  <View style={styles.rowBetween}>
                    <View>
                      <Text style={[styles.sectionLabel, { color: C.t2 }]}>Next payout</Text>
                      {next_payout ? (
                        <>
                          <Text style={[styles.payoutAmount, { color: C.t1 }]}>ZMW {next_payout.amount_zmw.toFixed(0)}</Text>
                          <Text style={[styles.hint, { color: C.t3 }]}>{payoutCountdown(next_payout.eligible_at)}</Text>
                        </>
                      ) : (
                        <Text style={[styles.hint, { color: C.t3 }]}>No pending payouts</Text>
                      )}
                    </View>
                    <View style={[styles.holdBadge, { borderColor: C.border }]}>
                      <Ionicons name="time-outline" size={12} color={C.t3} />
                      <Text style={[styles.holdText, { color: C.t3 }]}>{tier.payout_hold_hours}h hold</Text>
                    </View>
                  </View>

                  {/* Instant payout — Tier 3+ only; hidden when ineligible (v3 §8.6) */}
                  {instant_payout.eligible && (
                    <TouchableRipple
                      onPress={soon('Instant payout')}
                      style={styles.instantBtn}
                      borderless
                      accessibilityRole="button"
                      accessibilityLabel={`Instant payout — ${feePct}% fee`}
                    >
                      <View style={styles.instantBtnInner}>
                        <Ionicons name="flash" size={16} color={palette.warning} />
                        <Text style={styles.instantBtnText}>Instant payout · {feePct}% fee</Text>
                      </View>
                    </TouchableRipple>
                  )}
                </>
              )}
            </>
          )}
        </View>

        {/* ── 3. TODAY ──────────────────────────────────────────────────── */}
        <View style={cardStyle}>
          <Text style={[styles.sectionLabel, { color: C.t2 }]}>Today</Text>

          {/* New requests row → Requests tab */}
          <TouchableRipple
            onPress={() => navigation.navigate('Requests')}
            borderless
            accessibilityRole="button"
            accessibilityLabel={newReqs > 0 ? `${newReqs} new requests — reply within 30 minutes` : 'No new requests'}
            style={styles.todayRipple}
          >
            <View style={styles.todayRow}>
              <View style={[styles.todayIcon, { backgroundColor: newReqs > 0 ? palette.warningLight : C.border }]}>
                <Ionicons name="mail-outline" size={18} color={newReqs > 0 ? palette.warning : C.t3} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.todayTitle, { color: C.t1 }]}>
                  {newReqs > 0 ? `${newReqs} new ${newReqs === 1 ? 'request' : 'requests'}` : 'No new requests'}
                </Text>
                {newReqs > 0 && (
                  <Text style={[styles.todayHint, { color: palette.warning }]}>Reply within 30 min</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={C.t3} />
            </View>
          </TouchableRipple>

          <Divider style={{ backgroundColor: C.border, marginVertical: spacing.xs }} />

          {/* Next job */}
          {today?.next_job ? (
            <View style={styles.todayRow}>
              <View style={[styles.todayIcon, { backgroundColor: palette.primaryLight }]}>
                <Ionicons name="calendar-outline" size={18} color={palette.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.todayTitle, { color: C.t1 }]} numberOfLines={1}>
                  {today.next_job.service_title}
                </Text>
                <Text style={[styles.todayHint, { color: C.t2 }]}>
                  {formatJobTime(today.next_job.scheduled_at)} · {today.next_job.location_label}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.todayRow}>
              <View style={[styles.todayIcon, { backgroundColor: C.border }]}>
                <Ionicons name="calendar-outline" size={18} color={C.t3} />
              </View>
              <Text style={[styles.todayHint, { color: C.t3 }]}>No jobs scheduled today</Text>
            </View>
          )}
        </View>

        {/* ── 4. STATS ──────────────────────────────────────────────────── */}
        <View style={[styles.card, styles.statsCard, { backgroundColor: C.surface, borderColor: C.border }]}>
          <StatTile
            icon="star"
            value={stats?.rating != null ? stats.rating.toFixed(1) : '–'}
            label="Rating"
            t1={C.t1} t2={C.t2}
          />
          <View style={[styles.statDivider, { backgroundColor: C.border }]} />
          <StatTile
            icon="flash-outline"
            value={stats?.response_time_p50_mins != null ? `${stats.response_time_p50_mins}m` : '–'}
            label="Response"
            t1={C.t1} t2={C.t2}
          />
          <View style={[styles.statDivider, { backgroundColor: C.border }]} />
          <StatTile
            icon="repeat-outline"
            value={fmtRate(stats?.repeat_client_rate)}
            label="Repeat"
            t1={C.t1} t2={C.t2}
          />
          <View style={[styles.statDivider, { backgroundColor: C.border }]} />
          <StatTile
            icon="checkmark-circle-outline"
            value={String(stats?.jobs_done ?? 0)}
            label="Jobs"
            t1={C.t1} t2={C.t2}
          />
        </View>

        {/* Earned badges — rendered compactly below stats */}
        {earned_badges.length > 0 && (
          <View style={styles.badgeRow}>
            {earned_badges.map(key => {
              const meta = EARNED_BADGE_META[key];
              if (!meta) return null;
              return (
                <View key={key} style={[styles.badgeChip, { borderColor: meta.color }]}>
                  <Ionicons name={meta.icon as any} size={12} color={meta.color} />
                  <Text style={[styles.badgeChipText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── 5. PROFILE STRENGTH ───────────────────────────────────────── */}
        <TouchableRipple
          onPress={() => {
            const dest: Record<string, string> = {
              profile_photo: 'ProviderProfileEdit', bio: 'ProviderProfileEdit',
              portfolio_image: 'ProviderProfileEdit', three_services: 'Services',
              weekly_availability: 'ProviderSetup',
              kyc_tier_2: 'Kyc', tier_3: 'Kyc',
              first_booking: 'Requests', first_review: 'Requests',
            };
            navigation.navigate(dest[checklist.next?.key ?? ''] ?? 'ProviderProfileEdit');
          }}
          borderless
          accessibilityRole="button"
          accessibilityLabel={`Profile strength ${profile_completeness} out of 100 — tap to improve`}
          style={cardStyle}
        >
          <View>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionLabel, { color: C.t2 }]}>Profile strength</Text>
              <Text style={[styles.strengthScore, { color: palette.primary }]}>{profile_completeness} / 100</Text>
            </View>
            <ProgressBar progress={profile_completeness / 100} color={palette.primary} style={styles.bar} />
            {checklist.next ? (
              <View style={styles.nextActionBanner}>
                <Ionicons name="arrow-forward-circle-outline" size={16} color={palette.primary} />
                <Text style={[styles.nextActionText]} numberOfLines={2}>
                  {'Next: '}
                  <Text style={styles.nextActionBold}>{checklist.next.label}</Text>
                  {` · +${checklist.next.points} pts`}
                </Text>
              </View>
            ) : (
              <Text style={[styles.hint, { color: palette.success, marginTop: spacing.xs }]}>
                Profile complete — well done!
              </Text>
            )}
          </View>
        </TouchableRipple>

        {/* ── 6. TIER UNLOCK ────────────────────────────────────────────── */}
        {next_tier ? (
          <View style={cardStyle}>
            <Text style={[styles.sectionLabel, { color: C.t2 }]}>
              Unlock {next_tier.label}
            </Text>
            <View style={styles.reqList}>
              {next_tier.requirements.map((req, i) => (
                <View key={i} style={styles.reqRow}>
                  <View style={[styles.reqDot, { backgroundColor: palette.primary }]} />
                  <Text style={[styles.reqText, { color: C.t2 }]}>{req}</Text>
                </View>
              ))}
            </View>
            <ProgressBar
              progress={next_tier.progress ?? 0}
              color={tierColor}
              style={[styles.bar, { marginTop: spacing.sm }]}
            />
            {(next_tier.unlocks?.length ?? 0) > 0 && (
              <View style={[styles.unlocksBanner, { backgroundColor: C.border }]}>
                <Text style={[styles.hint, { color: C.t2 }]}>
                  {'Unlocks: '}
                  <Text style={{ color: C.t1, fontFamily: 'PlusJakartaSans_500Medium' }}>
                    {next_tier.unlocks!.join(' · ')}
                  </Text>
                </Text>
              </View>
            )}
            {/* Tier 4 is earned through completed jobs, not a document flow */}
            {next_tier.value <= 3 && (
              <TouchableOpacity
                onPress={() => navigation.navigate('Kyc')}
                style={styles.emptyAction}
                accessibilityRole="button"
                accessibilityLabel={`Start verification for ${next_tier.label}`}
              >
                <Text style={styles.emptyActionText}>Continue verification</Text>
                <Ionicons name="arrow-forward" size={14} color={palette.primary} />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={cardStyle}>
            <Text style={[styles.sectionLabel, { color: C.t2 }]}>Top tier achieved</Text>
            <Text style={[styles.hint, { color: C.t2, marginTop: spacing.xs }]}>
              You're a Professional provider — Sebenza's highest trust tier. Keep your record clean and your clients happy to stay there.
            </Text>
          </View>
        )}

        {/* ── 7. GROW ───────────────────────────────────────────────────── */}
        {(currentPlan !== 'ELITE' || tier.value >= 3) && (
          <View style={cardStyle}>
            <Text style={[styles.sectionLabel, { color: C.t2 }]}>Grow</Text>

            {/* Subscription upgrade — hide when on Elite (already at best rate) */}
            {currentPlan !== 'ELITE' && (
              <View style={styles.growPlan}>
                <View style={styles.rowBetween}>
                  <View>
                    <Text style={[styles.growPlanTitle, { color: C.t1 }]}>
                      {currentPlan === 'FREE' ? 'Pro · ZMW 149 / mo' : 'Elite · ZMW 449 / mo'}
                    </Text>
                    <Text style={[styles.growPlanSub]}>
                      Keep {currentPlan === 'FREE' ? '2%' : '4%'} more on every job
                    </Text>
                  </View>
                  <Chip
                    compact
                    mode="flat"
                    style={{ backgroundColor: palette.primaryLight }}
                    textStyle={{ fontSize: 11, color: palette.primary }}
                  >
                    {currentPlan === 'FREE' ? 'PRO' : 'ELITE'}
                  </Chip>
                </View>
                <Text style={[styles.growFeatures, { color: C.t2 }]}>
                  {currentPlan === 'FREE'
                    ? '1 promoted slot/mo · Priority support · Richer analytics'
                    : '3 promoted slots/mo · Elite badge · Featured placement · Calendar sync'}
                </Text>
                <TouchableOpacity
                  onPress={soon('Subscription plans')}
                  style={styles.growBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Upgrade to ${currentPlan === 'FREE' ? 'Pro' : 'Elite'}`}
                >
                  <Text style={styles.growBtnText}>
                    Upgrade to {currentPlan === 'FREE' ? 'Pro' : 'Elite'}
                  </Text>
                  <Ionicons name="arrow-forward" size={14} color={palette.primary} />
                </TouchableOpacity>
              </View>
            )}

            {/* Promoted slots — Tier 3+ only (v3 §8.5) */}
            {tier.value >= 3 && (
              <>
                {currentPlan !== 'ELITE' && (
                  <Divider style={{ backgroundColor: C.border, marginVertical: spacing.sm }} />
                )}
                <TouchableRipple
                  onPress={soon('Promoted slots')}
                  borderless
                  accessibilityRole="button"
                  accessibilityLabel="Promote your listing — appear at the top of search"
                  style={styles.promoteRipple}
                >
                  <View style={styles.todayRow}>
                    <View style={[styles.todayIcon, { backgroundColor: palette.warningLight }]}>
                      <Ionicons name="megaphone-outline" size={18} color={palette.warning} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.todayTitle, { color: C.t1 }]}>Promote your listing</Text>
                      <Text style={[styles.todayHint, { color: C.t2 }]}>Appear at the top of search in your category</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={C.t3} />
                  </View>
                </TouchableRipple>
              </>
            )}
          </View>
        )}

        {/* ── 8. MANAGE ─────────────────────────────────────────────────── */}
        <View style={styles.manageSection}>
          <Text style={[styles.sectionLabel, { color: C.t2 }]}>Manage</Text>
          <View style={cardStyle}>
            <ManageLink icon="person-circle-outline" label="Profile & highlights"
              onPress={() => navigation.navigate('ProviderProfileEdit')} t1={C.t1} t2={C.t2} t3={C.t3} />
            <Divider style={{ backgroundColor: C.border }} />
            <ManageLink icon="construct-outline" label="Services"
              onPress={() => navigation.navigate('Services')} t1={C.t1} t2={C.t2} t3={C.t3} />
            <Divider style={{ backgroundColor: C.border }} />
            <ManageLink icon="calendar-outline" label="Availability"
              onPress={() => navigation.navigate('ProviderSetup')} t1={C.t1} t2={C.t2} t3={C.t3} />
            <Divider style={{ backgroundColor: C.border }} />
            <ManageLink icon="cash-outline" label="Earnings & analytics"
              onPress={() => navigation.navigate('Earnings')} t1={C.t1} t2={C.t2} t3={C.t3} />
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  scroll: { padding: spacing.lg, paddingTop: spacing.md, gap: spacing.md },

  card: {
    borderRadius: r.xl,
    borderWidth:  0.5,
    padding:      spacing.md,
    ...shadow.card,
  },

  // ── Header ──
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 },
  headerMeta: { flex: 1, gap: 4, minWidth: 0 },
  headerName: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 16, lineHeight: 22 },
  headerRight:{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs },

  iconBtn:       { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  notifDot: {
    position: 'absolute', top: 6, right: 6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: palette.danger,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 2,
  },
  notifDotText:  { color: '#fff', fontSize: 9, fontFamily: 'PlusJakartaSans_600SemiBold' },
  availRow:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  availLabel:    { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12 },

  // ── Shared ──
  sectionLabel: { ...typography.label, fontSize: 12, marginBottom: spacing.xs },
  rowBetween:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bar:  { height: 6, borderRadius: 3, marginVertical: spacing.xs },
  hint: { ...typography.bodySmall, fontSize: 12 },

  // ── Earnings ──
  earningsAmount: { ...typography.heading2, marginVertical: 4 },
  payoutAmount:   { ...typography.heading3, marginTop: 2 },
  holdBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: r.full,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  holdText:    { ...typography.bodySmall, fontSize: 11 },
  instantBtn:  { marginTop: spacing.sm, borderRadius: r.md, backgroundColor: palette.warningLight },
  instantBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: 10 },
  instantBtnText:  { ...typography.label, color: palette.warning, fontSize: 13 },

  // New-provider empty state
  emptyHeading:   { ...typography.label, fontSize: 15, marginBottom: spacing.xs },
  emptyBody:      { ...typography.bodySmall, lineHeight: 20, marginBottom: spacing.sm },
  emptyAction:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, minHeight: 44 },
  emptyActionText:{ ...typography.label, color: palette.primary, fontSize: 13 },

  // ── Get listed ──
  listingRipple:  { borderRadius: r.md },
  listingRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, minHeight: 44 },
  listingStepDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  listingStepNum: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13 },
  listingLabel:   { ...typography.body, flex: 1, fontSize: 14 },
  liveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    borderWidth: 1, borderRadius: r.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
  },
  liveBannerText: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12 },

  // ── Today ──
  todayRipple: { borderRadius: r.md },
  todayRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, minHeight: 44 },
  todayIcon:   { width: 40, height: 40, borderRadius: r.full, alignItems: 'center', justifyContent: 'center' },
  todayTitle:  { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, lineHeight: 20 },
  todayHint:   { ...typography.bodySmall, fontSize: 12 },

  // ── Stats ──
  statsCard:   { flexDirection: 'row', alignItems: 'center' },
  statTile:    { flex: 1, alignItems: 'center', gap: 2, paddingVertical: spacing.xs },
  statValue:   { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 15, lineHeight: 22 },
  statLabel:   { ...typography.bodySmall, fontSize: 11 },
  statDivider: { width: 1, height: 36, borderRadius: 1 },

  // Earned badges row
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badgeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderRadius: r.full,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  badgeChipText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11 },

  // ── Profile strength ──
  strengthScore:   { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 18, color: palette.primary },
  nextActionBanner:{
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    backgroundColor: palette.primaryLight, borderRadius: r.md,
    padding: spacing.sm, marginTop: spacing.xs,
  },
  nextActionText: { ...typography.bodySmall, flex: 1, color: palette.primary },
  nextActionBold: { fontFamily: 'PlusJakartaSans_600SemiBold' },

  // ── Tier unlock ──
  reqList: { gap: spacing.xs, marginTop: spacing.xs },
  reqRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  reqDot:  { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  reqText: { ...typography.bodySmall, flex: 1, lineHeight: 18 },
  unlocksBanner: { borderRadius: r.md, padding: spacing.sm, marginTop: spacing.xs },

  // ── Grow ──
  growPlan:      { gap: spacing.xs },
  growPlanTitle: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 15 },
  growPlanSub:   { ...typography.bodySmall, fontSize: 12, color: palette.success },
  growFeatures:  { ...typography.bodySmall, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  growBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, minHeight: 44,
  },
  growBtnText:  { ...typography.label, color: palette.primary, fontSize: 13 },
  promoteRipple:{ borderRadius: r.md },

  // ── Manage ──
  manageSection: { gap: spacing.sm },
  manageRipple:  {},
  manageRow:     { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md, minHeight: 52 },
  manageLabel:   { ...typography.body, flex: 1 },
});
