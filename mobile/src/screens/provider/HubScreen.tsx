import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  useColorScheme,
  View,
} from "react-native";
import { ProgressBar, Text, TouchableRipple } from "react-native-paper";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  EARNED_BADGE_META,
  VettingBadge,
} from "../../components/discovery/VettingBadge";
import { Card, Divider } from "../../components/ui/Card";
import { NotificationBell } from "../../components/ui/NotificationBell";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { CardSkeleton } from "../../components/ui/SkeletonBlock";
import { useSnackbar } from "../../providers/SnackbarProvider";
import { useProfileStore } from "../../store/profileStore";
import { palette, radius as r, spacing, typography } from "../../theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
type TabKey = "overview" | "manage";

// ── Theme (dark/light, AA) ──────────────────────────────────────────────────
type ThemeC = {
  bg: string;
  surface: string;
  border: string;
  t1: string;
  t2: string;
  t3: string;
};
const DARK: ThemeC = {
  bg: "#0F0A0D",
  surface: "#1C1015",
  border: "#3A2030",
  t1: "#F5E8EE",
  t2: "#C79BB0",
  t3: "#7C5868",
};
const LIGHT: ThemeC = {
  bg: palette.background,
  surface: palette.surface,
  border: palette.border,
  t1: palette.textPrimary,
  t2: palette.textSecondary,
  t3: palette.textDisabled,
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function initials(name?: string | null): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function payoutCountdown(eligibleAt: string | null): string {
  if (!eligibleAt) return "Pending completion";
  const diff = new Date(eligibleAt).getTime() - Date.now();
  if (diff <= 0) return "Ready now";
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(h / 24);
  if (d > 0) return `In ${d}d ${h % 24}h`;
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `In ${h}h ${m}m` : `In ${m}m`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function formatJobTime(iso: string): string {
  const d = new Date(iso),
    now = new Date(),
    tom = new Date(now.getTime() + 86_400_000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const same = (a: Date, b: Date) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();
  if (same(d, now)) return `Today · ${time}`;
  if (same(d, tom)) return `Tomorrow · ${time}`;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONS[d.getMonth()]} · ${time}`;
}

function fmtRate(v: number | null | undefined): string {
  return v != null ? `${(v * 100).toFixed(0)}%` : "–";
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

// ── Small primitives ────────────────────────────────────────────────────────
// Progress meter that respects prefers-reduced-motion (static fill when reduced).
function Meter({
  progress,
  color,
  c,
  reduced,
}: {
  progress: number;
  color: string;
  c: ThemeC;
  reduced: boolean;
}) {
  if (reduced) {
    return (
      <View style={[styles.meterTrack, { backgroundColor: c.border }]}>
        <View
          style={[
            styles.meterFill,
            {
              backgroundColor: color,
              width: `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%`,
            },
          ]}
        />
      </View>
    );
  }
  return (
    <ProgressBar
      progress={progress}
      color={color}
      style={[styles.meterTrack, { backgroundColor: c.border }]}
    />
  );
}

function ProviderAvatar({
  uri,
  name,
  size = 48,
}: {
  uri?: string | null;
  name?: string | null;
  size?: number;
}) {
  const [err, setErr] = useState(false);
  if (uri && !err) {
    return (
      <Image
        source={{ uri }}
        onError={() => setErr(true)}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette.border,
        }}
        accessibilityRole="image"
        accessibilityLabel="Profile photo"
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: palette.primaryLight,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityRole="image"
      accessibilityLabel={`Avatar: ${initials(name)}`}
    >
      <Text
        style={{
          fontFamily: "DMSans_600SemiBold",
          fontSize: size * 0.36,
          color: palette.primary,
        }}
      >
        {initials(name)}
      </Text>
    </View>
  );
}

function TabBar({
  c,
  active,
  onChange,
}: {
  c: ThemeC;
  active: TabKey;
  onChange: (k: TabKey) => void;
}) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "manage", label: "Manage" },
  ];
  return (
    <View
      style={[styles.tabBar, { borderBottomColor: c.border }]}
      accessibilityRole="tablist"
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <TouchableRipple
            key={t.key}
            onPress={() => onChange(t.key)}
            borderless
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
            style={styles.tabTap}
          >
            <View
              style={[styles.tab, on && { borderBottomColor: palette.primary }]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: on ? palette.primary : c.t2 },
                  on && styles.tabTextActive,
                ]}
              >
                {t.label}
              </Text>
            </View>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

function StatTile({
  icon,
  value,
  label,
  c,
}: {
  icon: IconName;
  value: string;
  label: string;
  c: ThemeC;
}) {
  return (
    <View style={styles.statTile} accessibilityLabel={`${label}: ${value}`}>
      <Ionicons name={icon} size={18} color={palette.primary} />
      <Text style={[styles.statValue, { color: c.t1 }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: c.t2 }]}>{label}</Text>
    </View>
  );
}

function ManageLink({
  icon,
  label,
  onPress,
  c,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  c: ThemeC;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      borderless
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.manageRow}>
        <View
          style={[styles.iconChip, { backgroundColor: palette.primaryLight }]}
        >
          <Ionicons name={icon} size={18} color={palette.primary} />
        </View>
        <Text style={[styles.manageLabel, { color: c.t1 }]}>{label}</Text>
        <Ionicons name="chevron-forward" size={16} color={c.t3} />
      </View>
    </TouchableRipple>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────
export default function HubScreen({ navigation }: any) {
  const {
    dashboard,
    loading,
    error,
    fetchDashboard,
    clearError,
    toggleAcceptingBookings,
  } = useProfileStore();
  const { showError, showSnackbar } = useSnackbar();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const c = scheme === "dark" ? DARK : LIGHT;
  const reduced = useReducedMotion();

  const [tab, setTab] = useState<TabKey>("overview");
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    fetchDashboard();
  }, []);
  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  // Resumable onboarding: while the provider isn't listed yet, the setup
  // timeline is their home. Send them there once per Hub mount (re-tapping the
  // Hub tab resets this stack, so a still-incomplete provider lands on the
  // timeline again on app reopen). Listed providers are never redirected.
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (
      !redirectedRef.current &&
      dashboard?.listing &&
      !dashboard.listing.listed
    ) {
      redirectedRef.current = true;
      navigation.replace("SetupTimeline");
    }
  }, [dashboard]);

  const handleAvailToggle = useCallback(
    async (val: boolean) => {
      setToggling(true);
      try {
        await toggleAcceptingBookings(val);
      } finally {
        setToggling(false);
      }
    },
    [toggleAcceptingBookings]
  );

  const soon = (what: string) => () =>
    showSnackbar({
      message: `${what} is coming soon — we'll let you know when it launches.`,
    });

  if (loading && !dashboard) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: c.bg }]}
        edges={["top", "left", "right"]}
      >
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {[1, 2, 3].map((k) => (
            <CardSkeleton key={k} style={{ height: 90, borderRadius: r.sm }} />
          ))}
        </View>
      </SafeAreaView>
    );
  }
  if (!dashboard)
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: palette.surface }]}
      />
    );

  const {
    tier,
    next_tier,
    profile_completeness,
    checklist,
    listing,
    earned_badges = [],
    earnings,
    next_payout,
    instant_payout,
    to_collect,
    accepting_bookings = true,
    profile_photo_url = null,
    display_name = null,
    today,
    stats,
    subscription,
    referral_code = null,
  } = dashboard;

  const isDirect = dashboard.payment_mode === "DIRECT";
  const isNewProvider = (stats?.jobs_done ?? 0) === 0;
  const newReqs = today?.new_requests ?? 0;
  const tierColor =
    [
      palette.textDisabled,
      palette.warning,
      palette.primary,
      palette.success,
      palette.warning,
    ][tier.value] ?? palette.primary;
  const feePct = ((instant_payout?.fee_rate ?? 0.01) * 100).toFixed(0);
  const currentPlan = subscription?.plan ?? "FREE";

  // ── Pinned earnings glance ─────────────────────────────────────────────────
  const renderEarnings = () => {
    if (isNewProvider) {
      return (
        <View>
          <Text style={[styles.glanceLabel, { color: c.t2 }]}>Earnings</Text>
          <Text style={[styles.glanceLead, { color: c.t1 }]}>
            Ready for your first booking
          </Text>
          <Text style={[styles.glanceBody, { color: c.t2 }]}>
            Finish your profile and list a service — what you earn will show
            here once you take on work.
          </Text>
          {checklist.next && (
            <TouchableRipple
              onPress={() =>
                navigation.navigate(nextActionDest(checklist.next!.key))
              }
              borderless
              accessibilityRole="button"
              accessibilityLabel={`Next: ${checklist.next.label}`}
              style={styles.nextChip}
            >
              <View style={styles.nextChipInner}>
                <Ionicons
                  name="arrow-forward-circle-outline"
                  size={16}
                  color={palette.primary}
                />
                <Text style={styles.nextChipText} numberOfLines={1}>
                  Next: {checklist.next.label} · +{checklist.next.points} pts
                </Text>
              </View>
            </TouchableRipple>
          )}
        </View>
      );
    }

    if (isDirect) {
      return (
        <View>
          <View style={styles.rowBetween}>
            <Text style={[styles.glanceLabel, { color: c.t2 }]}>
              Earned this week
            </Text>
            {earnings.trend && earnings.trend !== "flat" && (
              <Ionicons
                name={
                  earnings.trend === "up"
                    ? "trending-up-outline"
                    : "trending-down-outline"
                }
                size={18}
                color={
                  earnings.trend === "up" ? palette.success : palette.danger
                }
                accessibilityLabel={
                  earnings.trend === "up"
                    ? "Up from last week"
                    : "Down from last week"
                }
              />
            )}
          </View>
          <Text style={[styles.glanceAmount, { color: c.t1 }]}>
            ZMW {earnings.this_week_zmw.toFixed(0)}
          </Text>
          {/* {to_collect && to_collect.count > 0 ? (
            <TouchableRipple
              onPress={() => navigation.navigate("Earnings")}
              borderless
              accessibilityRole="button"
              accessibilityLabel={`ZMW ${to_collect.amount_zmw.toFixed(
                0
              )} to collect from ${to_collect.count} completed jobs`}
              style={styles.collectRow}
            >
              <View style={styles.collectInner}>
                <Ionicons
                  name="cash-outline"
                  size={16}
                  color={palette.success}
                />
                <Text style={[styles.collectText, { color: c.t1 }]}>
                  ZMW {to_collect.amount_zmw.toFixed(0)} to collect
                  <Text style={{ color: c.t2 }}>{`  ·  ${to_collect.count} ${
                    to_collect.count === 1 ? "job" : "jobs"
                  }`}</Text>
                </Text>
                <Ionicons name="chevron-forward" size={15} color={c.t3} />
              </View>
            </TouchableRipple>
          ) : (
            <Text style={[styles.glanceBody, { color: c.t3 }]}>
              You're all caught up — nothing to collect.
            </Text>
          )} */}
        </View>
      );
    }

    // ESCROW — payout mechanics return (driven off payment_mode).
    return (
      <View>
        <Text style={[styles.glanceLabel, { color: c.t2 }]}>This week</Text>
        <Text style={[styles.glanceAmount, { color: c.t1 }]}>
          ZMW {earnings.this_week_zmw.toFixed(0)}
        </Text>
        <View style={[styles.rowBetween, { marginTop: spacing.xs }]}>
          <View>
            <Text style={[styles.glanceLabel, { color: c.t2 }]}>
              Next payout
            </Text>
            {next_payout ? (
              <>
                <Text style={[styles.payoutAmount, { color: c.t1 }]}>
                  ZMW {next_payout.amount_zmw.toFixed(0)}
                </Text>
                <Text style={[styles.glanceBody, { color: c.t3 }]}>
                  {payoutCountdown(next_payout.eligible_at)}
                </Text>
              </>
            ) : (
              <Text style={[styles.glanceBody, { color: c.t3 }]}>
                No pending payouts
              </Text>
            )}
          </View>
          <View style={[styles.holdBadge, { borderColor: c.border }]}>
            <Ionicons name="time-outline" size={12} color={c.t3} />
            <Text style={[styles.holdText, { color: c.t3 }]}>
              {tier.payout_hold_hours}h hold
            </Text>
          </View>
        </View>
        {instant_payout?.eligible && (
          <TouchableRipple
            onPress={soon("Instant payout")}
            borderless
            style={styles.instantBtn}
            accessibilityRole="button"
            accessibilityLabel={`Instant payout — ${feePct}% fee`}
          >
            <View style={styles.instantInner}>
              <Ionicons name="flash" size={16} color={palette.warning} />
              <Text style={styles.instantText}>
                Instant payout · {feePct}% fee
              </Text>
            </View>
          </TouchableRipple>
        )}
      </View>
    );
  };

  const nextActionDest = (key: string): string =>
    ({
      profile_photo: "ProviderProfileEdit",
      bio: "ProviderProfileEdit",
      portfolio_image: "ProviderProfileEdit",
      three_services: "Services",
      weekly_availability: "ProviderSetup",
      kyc_tier_2: "Kyc",
      tier_3: "Kyc",
      first_booking: "Requests",
      first_review: "Requests",
    }[key] ?? "ProviderProfileEdit");

  const cardStyle = {
    backgroundColor: c.surface,
    borderColor: c.border,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  };
  const dividerColor = { backgroundColor: c.border };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: c.bg }]}
      edges={["top", "left", "right"]}
    >
      <ScreenHeader title="Hub" right={<NotificationBell color={c.t1} />} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 100 },
        ]}
      >
        {/* ══ PINNED GLANCE — single card ══ */}
        <Card padding={0} style={cardStyle}>
          {/* Header */}
          <View style={styles.sectionPad}>
            <View style={styles.header}>
              <ProviderAvatar
                uri={profile_photo_url}
                name={display_name}
                size={48}
              />
              <View style={styles.headerMeta}>
                <Text
                  style={[styles.headerName, { color: c.t1 }]}
                  numberOfLines={1}
                >
                  {display_name ?? "Provider"}
                </Text>
                <VettingBadge trustTier={tier.value} size="sm" />
              </View>
              <View style={styles.availRow}>
                <Text
                  style={[
                    styles.availLabel,
                    { color: accepting_bookings ? palette.success : c.t3 },
                  ]}
                >
                  {accepting_bookings ? "Available" : "Away"}
                </Text>
                <Switch
                  value={accepting_bookings}
                  onValueChange={handleAvailToggle}
                  disabled={toggling}
                  trackColor={{ false: c.border, true: palette.successLight }}
                  thumbColor={accepting_bookings ? palette.success : c.t3}
                  accessibilityRole="switch"
                  accessibilityLabel="Availability — Away stops new booking requests"
                  accessibilityState={{
                    checked: accepting_bookings,
                    disabled: toggling,
                  }}
                />
              </View>
            </View>
          </View>

          <Divider inset={0} style={dividerColor} />

          {/* Earnings */}
          <View style={styles.sectionPad}>{renderEarnings()}</View>

          <Divider inset={0} style={dividerColor} />

          {/* New-requests alert — full-width touchable */}
          <TouchableRipple
            onPress={() => navigation.navigate("Requests")}
            borderless
            accessibilityRole="button"
            accessibilityLabel={
              newReqs > 0
                ? `${newReqs} new requests — reply within 30 minutes`
                : "No new requests"
            }
            style={[
              styles.sectionPad,
              newReqs > 0 && { backgroundColor: palette.warningLight },
            ]}
          >
            <View style={styles.reqInner}>
              <View
                style={[
                  styles.iconChip,
                  {
                    backgroundColor: newReqs > 0 ? "#fff" : c.border,
                  },
                ]}
              >
                <Ionicons
                  name="mail-outline"
                  size={18}
                  color={newReqs > 0 ? palette.warning : c.t3}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.reqTitle, { color: c.t1 }]}>
                  {newReqs > 0
                    ? `${newReqs} new ${newReqs === 1 ? "request" : "requests"}`
                    : "No new requests"}
                </Text>
                {newReqs > 0 && (
                  <Text style={[styles.reqHint, { color: palette.warning }]}>
                    Reply within 30 min
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.t3} />
            </View>
          </TouchableRipple>
        </Card>

        {/* ══ TABS ══ */}
        <TabBar c={c} active={tab} onChange={setTab} />

        {/* ══ TAB CONTENT — single card per tab ══ */}
        {tab === "overview" ? (
          <Card padding={0} style={{ ...cardStyle, marginTop: spacing.md }}>
            {/* Listing status (conditional first section) */}
            {listing && !listing.listed && (
              <>
                <View style={styles.sectionPad}>
                  <Text style={[styles.sectionLabel, { color: c.t2 }]}>
                    Get listed in search
                  </Text>
                  <Text
                    style={[
                      styles.glanceBody,
                      { color: c.t2, marginBottom: spacing.xs },
                    ]}
                  >
                    Finish these in order — once all three are done, customers
                    can find you.
                  </Text>
                  {listing.steps.map((step, i) => {
                    const dest: Record<string, string> = {
                      verify_identity: "Kyc",
                      profile_strength: "ProviderProfileEdit",
                      active_service: "Services",
                    };
                    const isNext =
                      !step.done &&
                      listing.steps.slice(0, i).every((s) => s.done);
                    return (
                      <TouchableRipple
                        key={step.key}
                        onPress={() =>
                          navigation.navigate(
                            dest[step.key] ?? "ProviderProfileEdit"
                          )
                        }
                        disabled={step.done}
                        borderless
                        accessibilityRole="button"
                        accessibilityLabel={`Step ${i + 1}: ${step.label}${
                          step.done ? " — done" : ""
                        }`}
                      >
                        <View style={styles.listingRow}>
                          <View
                            style={[
                              styles.stepDot,
                              {
                                backgroundColor: step.done
                                  ? palette.successLight
                                  : isNext
                                  ? palette.primaryLight
                                  : c.border,
                              },
                            ]}
                          >
                            {step.done ? (
                              <Ionicons
                                name="checkmark"
                                size={14}
                                color={palette.success}
                              />
                            ) : (
                              <Text
                                style={[
                                  styles.stepNum,
                                  { color: isNext ? palette.primary : c.t3 },
                                ]}
                              >
                                {i + 1}
                              </Text>
                            )}
                          </View>
                          <Text
                            style={[
                              styles.listingLabel,
                              { color: step.done ? c.t3 : c.t1 },
                              step.done && {
                                textDecorationLine: "line-through",
                              },
                            ]}
                          >
                            {step.label}
                          </Text>
                          {!step.done && (
                            <Ionicons
                              name="chevron-forward"
                              size={16}
                              color={c.t3}
                            />
                          )}
                        </View>
                      </TouchableRipple>
                    );
                  })}
                </View>
                <Divider inset={0} style={dividerColor} />
              </>
            )}
            {listing?.listed && (
              <>
                <View style={styles.sectionPad}>
                  <View style={styles.liveRow}>
                    <Ionicons
                      name="radio-outline"
                      size={16}
                      color={palette.success}
                    />
                    <Text style={[styles.liveText, { color: palette.success }]}>
                      You're live — customers can find you in search
                    </Text>
                  </View>
                </View>
                <Divider inset={0} style={dividerColor} />
              </>
            )}

            {/* Next job */}
            <View style={styles.sectionPad}>
              <Text style={[styles.sectionLabel, { color: c.t2 }]}>
                Next job
              </Text>
              {today?.next_job ? (
                <View style={styles.iconLineRow}>
                  <View
                    style={[
                      styles.iconChip,
                      { backgroundColor: palette.primaryLight },
                    ]}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={18}
                      color={palette.primary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.jobTitle, { color: c.t1 }]}
                      numberOfLines={1}
                    >
                      {today.next_job.service_title}
                    </Text>
                    <Text
                      style={[styles.jobHint, { color: c.t2 }]}
                      numberOfLines={1}
                    >
                      {formatJobTime(today.next_job.scheduled_at)}
                      {today.next_job.location_label
                        ? ` · ${today.next_job.location_label}`
                        : ""}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={[styles.glanceBody, { color: c.t3 }]}>
                  No upcoming jobs scheduled.
                </Text>
              )}
            </View>

            <Divider inset={0} style={dividerColor} />

            {/* Performance */}
            <View style={styles.sectionPad}>
              <Text style={[styles.sectionLabel, { color: c.t2 }]}>
                Performance
              </Text>
              <View style={styles.statsRow}>
                <StatTile
                  icon="star"
                  value={stats?.rating != null ? stats.rating.toFixed(1) : "–"}
                  label="Rating"
                  c={c}
                />
                <View
                  style={[styles.statDivider, { backgroundColor: c.border }]}
                />
                <StatTile
                  icon="flash-outline"
                  value={
                    stats?.response_time_p50_mins != null
                      ? `${stats.response_time_p50_mins}m`
                      : "–"
                  }
                  label="Response"
                  c={c}
                />
                <View
                  style={[styles.statDivider, { backgroundColor: c.border }]}
                />
                <StatTile
                  icon="repeat-outline"
                  value={fmtRate(stats?.repeat_client_rate)}
                  label="Repeat"
                  c={c}
                />
                <View
                  style={[styles.statDivider, { backgroundColor: c.border }]}
                />
                <StatTile
                  icon="checkmark-circle-outline"
                  value={String(stats?.jobs_done ?? 0)}
                  label="Jobs"
                  c={c}
                />
              </View>
              {earned_badges.length > 0 && (
                <View style={styles.badgeRow}>
                  {earned_badges.map((key) => {
                    const meta = EARNED_BADGE_META[key];
                    if (!meta) return null;
                    return (
                      <View
                        key={key}
                        style={[styles.badgeChip, { borderColor: meta.color }]}
                      >
                        <Ionicons
                          name={meta.icon as any}
                          size={12}
                          color={meta.color}
                        />
                        <Text style={[styles.badgeText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            <Divider inset={0} style={dividerColor} />

            {/* Profile strength — full-width touchable */}
            <TouchableRipple
              onPress={() =>
                navigation.navigate(nextActionDest(checklist.next?.key ?? ""))
              }
              borderless
              accessibilityRole="button"
              accessibilityLabel={`Profile strength ${profile_completeness} out of 100 — tap to improve`}
              style={styles.sectionPad}
            >
              <View>
                <View style={styles.rowBetween}>
                  <Text style={[styles.sectionLabel, { color: c.t2 }]}>
                    Profile strength
                  </Text>
                  <Text style={styles.strengthScore}>
                    {profile_completeness} / 100
                  </Text>
                </View>
                <Meter
                  progress={profile_completeness / 100}
                  color={palette.primary}
                  c={c}
                  reduced={reduced}
                />
                {checklist.next ? (
                  <View style={styles.nextChipInner}>
                    <Ionicons
                      name="arrow-forward-circle-outline"
                      size={16}
                      color={palette.primary}
                    />
                    <Text style={styles.nextChipText} numberOfLines={2}>
                      Next:{" "}
                      <Text style={styles.nextBold}>
                        {checklist.next.label}
                      </Text>{" "}
                      · +{checklist.next.points} pts
                    </Text>
                  </View>
                ) : (
                  <Text
                    style={[
                      styles.glanceBody,
                      { color: palette.success, marginTop: spacing.xs },
                    ]}
                  >
                    Profile complete — well done!
                  </Text>
                )}
              </View>
            </TouchableRipple>

            <Divider inset={0} style={dividerColor} />

            {/* Tier progress */}
            <View style={styles.sectionPad}>
              {next_tier ? (
                <View>
                  <Text style={[styles.sectionLabel, { color: c.t2 }]}>
                    Unlock {next_tier.label}
                  </Text>
                  <View style={styles.reqList}>
                    {next_tier.requirements.map((req, i) => (
                      <View key={i} style={styles.reqRow}>
                        <View
                          style={[
                            styles.reqDot,
                            { backgroundColor: palette.primary },
                          ]}
                        />
                        <Text style={[styles.reqText, { color: c.t2 }]}>
                          {req}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <Meter
                    progress={next_tier.progress ?? 0}
                    color={tierColor}
                    c={c}
                    reduced={reduced}
                  />
                  {(next_tier.unlocks?.length ?? 0) > 0 && (
                    <Text
                      style={[
                        styles.glanceBody,
                        { color: c.t2, marginTop: spacing.xs },
                      ]}
                    >
                      Unlocks:{" "}
                      <Text
                        style={{
                          color: c.t1,
                          fontFamily: "DMSans_500Medium",
                        }}
                      >
                        {next_tier.unlocks!.join(" · ")}
                      </Text>
                    </Text>
                  )}
                  {next_tier.value <= 3 && (
                    <TouchableRipple
                      onPress={() => navigation.navigate("Kyc")}
                      borderless
                      accessibilityRole="button"
                      accessibilityLabel={`Continue verification for ${next_tier.label}`}
                      style={styles.inlineAction}
                    >
                      <View style={styles.inlineActionInner}>
                        <Text style={styles.inlineActionText}>
                          Continue verification
                        </Text>
                        <Ionicons
                          name="arrow-forward"
                          size={14}
                          color={palette.primary}
                        />
                      </View>
                    </TouchableRipple>
                  )}
                </View>
              ) : (
                <View>
                  <Text style={[styles.sectionLabel, { color: c.t2 }]}>
                    Top tier achieved
                  </Text>
                  <Text style={[styles.glanceBody, { color: c.t2 }]}>
                    You're a Professional provider — Sebenza's highest trust
                    tier. Keep your record clean to stay there.
                  </Text>
                </View>
              )}
            </View>

            <Divider inset={0} style={dividerColor} />

            {/* Referral — full-width touchable */}
            <TouchableRipple
              onPress={soon("Referrals")}
              borderless
              accessibilityRole="button"
              accessibilityLabel="Refer and earn ZMW 20 per provider"
              style={styles.sectionPad}
            >
              <View style={styles.iconLineRow}>
                <View
                  style={[
                    styles.iconChip,
                    { backgroundColor: palette.successLight },
                  ]}
                >
                  <Ionicons
                    name="gift-outline"
                    size={18}
                    color={palette.success}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.jobTitle, { color: c.t1 }]}>
                    Refer & earn
                  </Text>
                  <Text style={[styles.jobHint, { color: c.t2 }]}>
                    ZMW 20 per provider you refer
                    {referral_code ? ` · code ${referral_code}` : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.t3} />
              </View>
            </TouchableRipple>

            {/* Grow — ESCROW only */}
            {!isDirect && (currentPlan !== "ELITE" || tier.value >= 3) && (
              <>
                <Divider inset={0} style={dividerColor} />
                <View
                  style={[styles.sectionPad, { paddingBottom: spacing.xs }]}
                >
                  <Text style={[styles.sectionLabel, { color: c.t2 }]}>
                    Grow
                  </Text>
                </View>
                {currentPlan !== "ELITE" && (
                  <TouchableRipple
                    onPress={soon("Subscription plans")}
                    borderless
                    accessibilityRole="button"
                    accessibilityLabel={`Upgrade to ${
                      currentPlan === "FREE" ? "Pro" : "Elite"
                    }`}
                    style={styles.touchRow}
                  >
                    <View style={styles.iconLineRow}>
                      <View
                        style={[
                          styles.iconChip,
                          { backgroundColor: palette.primaryLight },
                        ]}
                      >
                        <Ionicons
                          name="trending-up-outline"
                          size={18}
                          color={palette.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.jobTitle, { color: c.t1 }]}>
                          Upgrade to{" "}
                          {currentPlan === "FREE"
                            ? "Pro · ZMW 149/mo"
                            : "Elite · ZMW 449/mo"}
                        </Text>
                        <Text style={[styles.jobHint, { color: c.t2 }]}>
                          Keep {currentPlan === "FREE" ? "2%" : "4%"} more on
                          every job
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={c.t3} />
                    </View>
                  </TouchableRipple>
                )}
                {tier.value >= 3 && (
                  <TouchableRipple
                    onPress={soon("Promoted slots")}
                    borderless
                    accessibilityRole="button"
                    accessibilityLabel="Promote your listing"
                    style={styles.touchRow}
                  >
                    <View style={styles.iconLineRow}>
                      <View
                        style={[
                          styles.iconChip,
                          { backgroundColor: palette.warningLight },
                        ]}
                      >
                        <Ionicons
                          name="megaphone-outline"
                          size={18}
                          color={palette.warning}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.jobTitle, { color: c.t1 }]}>
                          Promote your listing
                        </Text>
                        <Text style={[styles.jobHint, { color: c.t2 }]}>
                          Appear at the top of search in your category
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={c.t3} />
                    </View>
                  </TouchableRipple>
                )}
              </>
            )}
          </Card>
        ) : (
          /* ── MANAGE — single card, dividers between rows ── */
          <Card padding={0} style={{ ...cardStyle, marginTop: spacing.md }}>
            <ManageLink
              icon="person-circle-outline"
              label="Profile & highlights"
              onPress={() => navigation.navigate("ProviderProfileEdit")}
              c={c}
            />
            <Divider inset={0} style={dividerColor} />
            <ManageLink
              icon="construct-outline"
              label="Services"
              onPress={() => navigation.navigate("Services")}
              c={c}
            />
            <Divider inset={0} style={dividerColor} />
            <ManageLink
              icon="calendar-outline"
              label="Availability"
              onPress={() => navigation.navigate("ProviderSetup")}
              c={c}
            />
            <Divider inset={0} style={dividerColor} />
            <ManageLink
              icon="cash-outline"
              label="Earnings & history"
              onPress={() => navigation.navigate("Earnings")}
              c={c}
            />
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.surface },
  scroll: { paddingTop: spacing.sm },

  sectionPad: { padding: spacing.md },
  touchRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerMeta: { flex: 1, gap: 4, minWidth: 0 },
  headerName: {
    fontFamily: "DMSans_500Medium",
    fontSize: 17,
    lineHeight: 22,
  },
  availRow: { alignItems: "center", gap: 2 },
  availLabel: { fontFamily: "DMSans_500Medium", fontSize: 12 },

  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  glanceLabel: {
    ...typography.label,
    fontSize: 13,
    fontFamily: "DMSans_400Regular",
  },
  glanceLead: { ...typography.heading3, fontSize: 18, marginTop: 2 },
  glanceBody: {
    ...typography.bodySmall,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  glanceAmount: {
    ...typography.heading1,
    fontSize: 30,
    lineHeight: 38,
    marginTop: 2,
  },

  collectRow: { borderRadius: r.sm, marginTop: spacing.sm },
  collectInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
  },
  collectText: {
    ...typography.body,
    fontSize: 15,
    flex: 1,
    fontFamily: "DMSans_500Medium",
  },

  payoutAmount: { ...typography.heading3, marginTop: 2 },
  holdBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: r.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  holdText: { ...typography.bodySmall, fontSize: 11 },
  instantBtn: {
    marginTop: spacing.sm,
    borderRadius: r.sm,
    backgroundColor: palette.warningLight,
  },
  instantInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 44,
  },
  instantText: { ...typography.label, color: palette.warning, fontSize: 13 },

  nextChip: {
    borderRadius: r.sm,
    marginTop: spacing.sm,
    backgroundColor: palette.primaryLight,
  },
  nextChipInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  nextChipText: {
    ...typography.bodySmall,
    flex: 1,
    color: palette.primary,
    fontSize: 13,
  },
  nextBold: { fontFamily: "DMSans_500Medium" },

  reqInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 56,
  },
  reqTitle: { fontFamily: "DMSans_500Medium", fontSize: 15 },
  reqHint: { ...typography.bodySmall, fontSize: 12, marginTop: 1 },

  // Tabs
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  tabTap: { flex: 1, borderRadius: r.sm },
  tab: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabText: { ...typography.body, fontSize: 15 },
  tabTextActive: { fontFamily: "DMSans_500Medium" },

  // Sections
  sectionLabel: { ...typography.label, fontSize: 13, marginBottom: spacing.xs },

  iconChip: {
    width: 40,
    height: 40,
    borderRadius: r.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  iconLineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
  },
  jobTitle: {
    fontFamily: "DMSans_500Medium",
    fontSize: 15,
    lineHeight: 20,
  },
  jobHint: { ...typography.bodySmall, fontSize: 12, marginTop: 1 },

  meterTrack: {
    height: 6,
    borderRadius: 3,
    marginVertical: spacing.xs,
    overflow: "hidden",
  },
  meterFill: { height: 6, borderRadius: 3 },

  // Listing steps
  listingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: r.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNum: { fontFamily: "DMSans_600SemiBold", fontSize: 13 },
  listingLabel: { ...typography.body, flex: 1, fontSize: 14 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  liveText: { fontFamily: "DMSans_500Medium", fontSize: 13 },

  // Stats
  statsRow: { flexDirection: "row", alignItems: "center" },
  statTile: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.xs,
  },
  statValue: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
    lineHeight: 22,
  },
  statLabel: { ...typography.bodySmall, fontSize: 11 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36 },

  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  badgeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: r.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeText: { fontFamily: "DMSans_500Medium", fontSize: 11 },

  // Profile strength
  strengthScore: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 17,
    color: palette.primary,
  },

  // Tier
  reqList: { gap: spacing.xs, marginVertical: spacing.xs },
  reqRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  reqDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  reqText: { ...typography.bodySmall, flex: 1, lineHeight: 18 },
  inlineAction: { marginTop: spacing.xs },
  inlineActionInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
  },
  inlineActionText: {
    ...typography.label,
    color: palette.primary,
    fontSize: 13,
  },

  manageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  manageLabel: { ...typography.body, flex: 1, fontSize: 16 },
});
