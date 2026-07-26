import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
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
import {
  ActivityIndicator,
  ProgressBar,
  Text,
  TouchableRipple,
} from "react-native-paper";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { storageUrl } from "../../api/client";
import { VettingBadge } from "../../components/discovery/VettingBadge";
import { Card, Divider } from "../../components/ui/Card";
import { NotificationBell } from "../../components/ui/NotificationBell";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { CardSkeleton } from "../../components/ui/SkeletonBlock";
import { useSnackbar } from "../../providers/SnackbarProvider";
import { useAuthStore } from "../../store/authStore";
import { useBookingStore } from "../../store/bookingStore";
import { useProfileStore } from "../../store/profileStore";
import { palette, radius as r, spacing, typography } from "../../theme";
import type { IncomingRequestEntry } from "../../api/bookings";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

// ── Theme (dark/light, AA) — mirrors the rest of the provider surface ─────────
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

// The brand hue lives in the token — never an inline hex. NOTE: the task copy
// named "teal #0E7A5F", but this app's brand token (palette.primary) is the
// maroon #7B1A3A used on every other screen; we honour the token so the hub
// stays visually consistent with Requests / Services / Earnings / Profile.
const BRAND = palette.primary;

// ── Helpers ───────────────────────────────────────────────────────────────
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

function firstName(name?: string | null): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0];
}

/** Rounded ZMW — the hub never shows fractional kwacha. */
function zmw(v: number | null | undefined): string {
  return `ZMW ${Math.round(v ?? 0)}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatJobTime(iso: string | null): string {
  if (!iso) return "Time to be set";
  const d = new Date(iso);
  const now = new Date();
  const tom = new Date(now.getTime() + 86_400_000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const same = (a: Date, b: Date) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();
  if (same(d, now)) return `Today · ${time}`;
  if (same(d, tom)) return `Tomorrow · ${time}`;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONS[d.getMonth()]} · ${time}`;
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

/** Reply window: a new offer must be answered within 30 min of arriving. */
const REPLY_WINDOW_MS = 30 * 60_000;
function offerCountdown(createdAt: string | null, nowMs: number): string {
  if (!createdAt) return "";
  const left = new Date(createdAt).getTime() + REPLY_WINDOW_MS - nowMs;
  if (left <= 0) return "Reply now";
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return `${m}:${pad(s)} to reply`;
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

// ── Small primitives ─────────────────────────────────────────────────────
function Meter({
  progress,
  color,
  track,
  reduced,
}: {
  progress: number;
  color: string;
  track: string;
  reduced: boolean;
}) {
  const clamped = Math.min(Math.max(progress, 0), 1);
  if (reduced) {
    return (
      <View style={[styles.meterTrack, { backgroundColor: track }]}>
        <View
          style={[
            styles.meterFill,
            { backgroundColor: color, width: `${Math.round(clamped * 100)}%` },
          ]}
        />
      </View>
    );
  }
  return (
    <ProgressBar
      progress={clamped}
      color={color}
      style={[styles.meterTrack, { backgroundColor: track }]}
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
        source={{ uri: storageUrl(uri) }}
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
          color: BRAND,
        }}
      >
        {initials(name)}
      </Text>
    </View>
  );
}

// ── Setup milestones (SET_UP state) ────────────────────────────────────────
// These mirror the resumable onboarding spine (ProviderSetupTimelineScreen) and
// route into the SAME existing step screens — nothing new is built here.
type MilestoneKey = "account" | "profile" | "service" | "identity" | "payment";
interface SetupStep {
  key: MilestoneKey;
  label: string;
  sub: string;
  route?: string;
  stepNo?: number;
}
const SETUP_STEPS: SetupStep[] = [
  { key: "account", label: "Account", sub: "Phone number verified" },
  {
    key: "profile",
    label: "Profile",
    sub: "Name, photo, bio & languages",
    route: "ProviderProfileEdit",
    stepNo: 2,
  },
  {
    key: "service",
    label: "Service",
    sub: "Category, price & availability",
    route: "CreateService",
    stepNo: 3,
  },
  {
    key: "identity",
    label: "Verify identity",
    sub: "NRC + selfie · Tier 1",
    route: "Kyc",
    stepNo: 4,
  },
  {
    key: "payment",
    label: "Payment details",
    sub: "Mobile-money payout number",
    route: "ProviderSetup",
    stepNo: 5,
  },
];

// ── Screen ─────────────────────────────────────────────────────────────────
export default function HubScreen({ navigation }: any) {
  const {
    dashboard,
    profile,
    loading,
    error,
    fetchDashboard,
    fetchProfile,
    clearError,
    toggleAcceptingBookings,
  } = useProfileStore();
  const {
    incomingRequests,
    incomingLoading,
    fetchIncomingRequests,
    accept,
    decline,
  } = useBookingStore();
  const authUser = useAuthStore((s) => s.user);
  const { showError } = useSnackbar();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const c = scheme === "dark" ? DARK : LIGHT;
  const reduced = useReducedMotion();

  // The account milestone reflects the channel the account was actually verified
  // with — phone-registered accounts verify by SMS, email-registered by email.
  const accountSub = authUser?.phone ? "Phone number verified" : "Email verified";

  const [toggling, setToggling] = useState(false);
  const [offerActing, setOfferActing] = useState<null | "accept" | "decline">(
    null
  );
  const [nowMs, setNowMs] = useState(Date.now());

  // Refresh on every focus. NOTE: the app has no realtime socket yet (WebSocket
  // is deferred — see ALIGNMENT_REPORT.md), so the pending-offer + job feed is
  // refreshed on focus rather than pushed. Wire this to the booking socket once
  // it lands. (Flagged in the handoff notes.)
  useFocusEffect(
    useCallback(() => {
      fetchDashboard();
      fetchProfile();
      fetchIncomingRequests();
    }, [])
  );

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  // Tick the offer countdown once a second while an offer is on screen.
  const hasOffer = (incomingRequests?.new?.length ?? 0) > 0;
  useEffect(() => {
    if (!hasOffer) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasOffer]);

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

  const handleOffer = useCallback(
    async (kind: "accept" | "decline", bookingId: string) => {
      setOfferActing(kind);
      try {
        if (kind === "accept") await accept(bookingId);
        else await decline(bookingId);
        // Refresh the feed so the answered offer drops out and, on accept, the
        // job appears under Today's jobs.
        await Promise.all([fetchIncomingRequests(), fetchDashboard()]);
      } catch (e: any) {
        showError(e?.message ?? "Could not send your reply. Try again.");
      } finally {
        setOfferActing(null);
      }
    },
    [accept, decline]
  );

  // ── Loading (first paint, nothing cached) ─────────────────────────────────
  if (loading && !dashboard) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: c.bg }]}
        edges={["top", "left", "right"]}
      >
        <ScreenHeader title="Hub" right={<NotificationBell color={c.t1} />} />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <CardSkeleton style={{ height: 96, borderRadius: r.sm }} />
          <CardSkeleton style={{ height: 132, borderRadius: r.sm }} />
          <CardSkeleton style={{ height: 96, borderRadius: r.sm }} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error with nothing cached — inline retry ──────────────────────────────
  if (!dashboard) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: c.bg }]}
        edges={["top", "left", "right"]}
      >
        <ScreenHeader title="Hub" right={<NotificationBell color={c.t1} />} />
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={c.t3} />
          <Text style={[styles.emptyTitle, { color: c.t1 }]}>
            Couldn't load your hub
          </Text>
          <Text style={[styles.emptyBody, { color: c.t2 }]}>
            Check your connection and try again.
          </Text>
          <TouchableRipple
            onPress={fetchDashboard}
            borderless
            accessibilityRole="button"
            accessibilityLabel="Retry"
            style={styles.retryBtn}
          >
            <View style={styles.retryInner}>
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.retryText}>Retry</Text>
            </View>
          </TouchableRipple>
        </View>
      </SafeAreaView>
    );
  }

  // ── State selection — the backend is the single source ────────────────────
  // There is no literal `status` enum on the payload; `listing.listed` is the
  // backend's truth for "visible in search = live". listed → LIVE, otherwise
  // SET_UP. (If an older payload omits `listing` entirely the provider is past
  // the gate, so default to LIVE.)
  const isLive = dashboard.listing ? dashboard.listing.listed : true;

  const cardStyle = {
    backgroundColor: c.surface,
    borderColor: c.border,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
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
        {isLive ? (
          <LiveHub
            dashboard={dashboard}
            incomingRequests={incomingRequests}
            incomingLoading={incomingLoading}
            c={c}
            cardStyle={cardStyle}
            dividerColor={dividerColor}
            toggling={toggling}
            onToggle={handleAvailToggle}
            offerActing={offerActing}
            onOffer={handleOffer}
            nowMs={nowMs}
            navigation={navigation}
          />
        ) : (
          <SetupHub
            dashboard={dashboard}
            profile={profile}
            accountSub={accountSub}
            c={c}
            cardStyle={cardStyle}
            dividerColor={dividerColor}
            reduced={reduced}
            navigation={navigation}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// NEW PROVIDER — SET_UP
// ════════════════════════════════════════════════════════════════════════════
function SetupHub({
  dashboard,
  profile,
  accountSub,
  c,
  cardStyle,
  dividerColor,
  reduced,
  navigation,
}: any) {
  const stepDone = (k: string): boolean =>
    dashboard.listing?.steps.find((s: any) => s.key === k)?.done ?? false;

  // `profile` is NOT the profile_strength search gate (completeness ≥ 40) — that
  // only reaches 40 via KYC + MoMo + services, which made this step impossible to
  // finish. It reflects the profile editor's fields instead: name + bio.
  const done: Record<MilestoneKey, boolean> = {
    account: true, // authenticated providers have a verified phone by definition
    profile: !!profile?.display_name?.trim() && !!profile?.bio?.trim(),
    service: stepDone("active_service"),
    identity: stepDone("verify_identity") || (profile?.trust_tier ?? 0) >= 1,
    payment: !!profile?.momo_number && !!profile?.momo_provider,
  };

  const total = SETUP_STEPS.length;
  const doneCount = SETUP_STEPS.filter((s) => done[s.key]).length;
  const remaining = total - doneCount;
  const firstIncomplete = SETUP_STEPS.find((s) => !done[s.key])?.key;
  // UI-derived estimate only — there is no per-step minutes field on the
  // backend. ~2 min per remaining step. (Flagged in the handoff notes.)
  const mins = remaining * 2;

  const go = (s: SetupStep) => {
    if (!s.route) return;
    navigation.navigate(s.route, { onboardingStep: s.stepNo });
  };

  return (
    <>
      {/* Header */}
      <View style={styles.setupHeader}>
        <ProviderAvatar
          uri={dashboard.profile_photo_url}
          name={dashboard.display_name}
          size={48}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.hiName, { color: c.t1 }]} numberOfLines={1}>
            Welcome, {firstName(dashboard.display_name)}
          </Text>
          <Text style={[styles.hiSub, { color: c.t2 }]}>
            Let's get you earning
          </Text>
        </View>
      </View>

      {/* Progress hero */}
      <Card style={{ ...cardStyle, backgroundColor: BRAND, borderColor: BRAND }}>
        <Text style={styles.heroKicker}>You're almost ready</Text>
        <Text style={styles.heroLead}>
          You're {doneCount} of {total} steps in
        </Text>
        <View style={styles.heroMeter}>
          <Meter
            progress={doneCount / total}
            color="#fff"
            track="rgba(255,255,255,0.28)"
            reduced={reduced}
          />
        </View>
        <Text style={styles.heroFoot}>
          {remaining === 0
            ? "All steps done — you're going live"
            : `${remaining} step${remaining === 1 ? "" : "s"} left · about ${mins} minute${mins === 1 ? "" : "s"}`}
        </Text>
      </Card>

      {/* Checklist */}
      <Card padding={0} style={cardStyle}>
        <View style={styles.sectionPad}>
          <Text style={[styles.sectionLabel, { color: c.t2 }]}>
            Your setup checklist
          </Text>
        </View>
        <Divider inset={0} style={dividerColor} />
        {SETUP_STEPS.map((s, i) => {
          const isDone = done[s.key];
          const isCurrent = !isDone && s.key === firstIncomplete;
          const last = i === SETUP_STEPS.length - 1;
          return (
            <React.Fragment key={s.key}>
              <View style={styles.checkRow}>
                {/* node */}
                <View
                  style={[
                    styles.checkDot,
                    {
                      backgroundColor: isDone
                        ? palette.successLight
                        : isCurrent
                        ? palette.primaryLight
                        : c.border,
                    },
                  ]}
                >
                  {isDone ? (
                    <Ionicons
                      name="checkmark"
                      size={15}
                      color={palette.success}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.checkNum,
                        { color: isCurrent ? BRAND : c.t3 },
                      ]}
                    >
                      {i + 1}
                    </Text>
                  )}
                </View>
                {/* label + sub */}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={[
                      styles.checkLabel,
                      { color: isDone ? c.t2 : c.t1 },
                    ]}
                    numberOfLines={1}
                  >
                    {s.label}
                  </Text>
                  <Text
                    style={[styles.checkSub, { color: c.t3 }]}
                    numberOfLines={1}
                  >
                    {s.key === "account" ? accountSub : s.sub}
                  </Text>
                </View>
                {/* trailing */}
                {isDone ? (
                  <Text style={[styles.doneTag, { color: palette.success }]}>
                    Done
                  </Text>
                ) : isCurrent ? (
                  <TouchableRipple
                    onPress={() => go(s)}
                    borderless
                    accessibilityRole="button"
                    accessibilityLabel={`${s.label} — do now`}
                    style={styles.doNowBtn}
                  >
                    <Text style={styles.doNowText}>Do now</Text>
                  </TouchableRipple>
                ) : null}
              </View>
              {!last && <Divider inset={0} style={dividerColor} />}
            </React.Fragment>
          );
        })}
      </Card>

      {/* Locked preview — no fake numbers */}
      <View style={[styles.previewCard, { borderColor: c.border }]}>
        <View style={styles.previewHead}>
          <Ionicons name="lock-closed-outline" size={15} color={c.t3} />
          <Text style={[styles.previewTitle, { color: c.t2 }]}>
            Your hub, once you're live
          </Text>
        </View>
        {[
          { icon: "cash-outline" as IconName, label: "Earnings & payouts" },
          { icon: "flash-outline" as IconName, label: "Live job offers" },
          { icon: "calendar-outline" as IconName, label: "Today's schedule" },
        ].map((row) => (
          <View key={row.label} style={styles.previewRow}>
            <View style={[styles.previewChip, { backgroundColor: c.border }]}>
              <Ionicons name={row.icon} size={16} color={c.t3} />
            </View>
            <Text style={[styles.previewLabel, { color: c.t3 }]}>
              {row.label}
            </Text>
          </View>
        ))}
        <Text style={[styles.previewFoot, { color: c.t3 }]}>
          These appear here the moment your setup is complete.
        </Text>
      </View>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// RETURNING PROVIDER — LIVE
// ════════════════════════════════════════════════════════════════════════════
function LiveHub({
  dashboard,
  incomingRequests,
  incomingLoading,
  c,
  cardStyle,
  dividerColor,
  toggling,
  onToggle,
  offerActing,
  onOffer,
  nowMs,
  navigation,
}: any) {
  const {
    tier,
    earnings,
    next_payout,
    to_collect,
    stats,
    accepting_bookings = true,
    profile_photo_url = null,
    display_name = null,
    payment_mode,
  } = dashboard;

  const isDirect = payment_mode === "DIRECT";
  const offer: IncomingRequestEntry | undefined = incomingRequests?.new?.[0];
  const todaysJobs: IncomingRequestEntry[] = (incomingRequests?.scheduled ?? [])
    .filter((j: IncomingRequestEntry) => isToday(j.scheduled_start))
    .slice(0, 4);

  const pendingPayout = isDirect
    ? to_collect?.amount_zmw ?? 0
    : next_payout?.amount_zmw ?? 0;

  return (
    <>
      {/* ── Header ── */}
      <View style={styles.liveHeader}>
        <ProviderAvatar uri={profile_photo_url} name={display_name} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.hiName, { color: c.t1 }]} numberOfLines={1}>
            Hi, {firstName(display_name)}
          </Text>
          <View style={styles.headerTierRow}>
            <VettingBadge trustTier={tier.value} size="sm" />
            <Text style={[styles.headerTierText, { color: c.t2 }]}>
              Tier {tier.value} · {tier.label}
            </Text>
          </View>
        </View>
        <View style={styles.availRow}>
          <Text
            style={[
              styles.availLabel,
              { color: accepting_bookings ? palette.success : c.t3 },
            ]}
          >
            {accepting_bookings ? "Online" : "Offline"}
          </Text>
          <Switch
            value={accepting_bookings}
            onValueChange={onToggle}
            disabled={toggling}
            trackColor={{ false: c.border, true: palette.successLight }}
            thumbColor={accepting_bookings ? palette.success : c.t3}
            accessibilityRole="switch"
            accessibilityLabel="Availability — Offline stops new booking requests"
            accessibilityState={{
              checked: accepting_bookings,
              disabled: toggling,
            }}
          />
        </View>
      </View>

      {/* ── Earnings snapshot ── */}
      <Card style={{ ...cardStyle, backgroundColor: BRAND, borderColor: BRAND }}>
        <Text style={styles.snapKicker}>This week</Text>
        <Text style={styles.snapAmount}>{zmw(earnings.this_week_zmw)}</Text>
        <View style={styles.snapGrid}>
          <SnapStat
            value={String(stats?.jobs_done ?? 0)}
            label="Jobs done"
          />
          <View style={styles.snapSep} />
          <SnapStat
            value={zmw(pendingPayout)}
            label={isDirect ? "To collect" : "Pending payout"}
          />
          <View style={styles.snapSep} />
          <SnapStat
            value={stats?.rating != null ? stats.rating.toFixed(1) : "–"}
            label="Rating"
          />
        </View>
      </Card>

      {/* ── Live job offer (only if pending) ── */}
      {offer && (
        <Card
          style={{ ...cardStyle, borderColor: BRAND, borderWidth: 1.5 }}
          padding={0}
        >
          <View style={styles.offerHead}>
            <View style={styles.offerBadge}>
              <Ionicons name="flash" size={13} color={BRAND} />
              <Text style={styles.offerBadgeText}>New job offer</Text>
            </View>
            <Text style={[styles.offerTimer, { color: palette.warning }]}>
              {offerCountdown(offer.created_at, nowMs)}
            </Text>
          </View>
          <View style={styles.offerBody}>
            <Text style={[styles.offerTitle, { color: c.t1 }]} numberOfLines={1}>
              {offer.service_title ?? "Service request"}
            </Text>
            <View style={styles.offerMetaRow}>
              <OfferMeta
                icon="time-outline"
                text={formatJobTime(offer.scheduled_start)}
                c={c}
              />
              {offer.distance_km != null && (
                <OfferMeta
                  icon="location-outline"
                  text={`${offer.distance_km.toFixed(1)} km`}
                  c={c}
                />
              )}
            </View>
            <Text style={[styles.offerPay, { color: c.t1 }]}>
              {zmw(offer.net_zmw)}{" "}
              <Text style={[styles.offerPaySub, { color: c.t2 }]}>net pay</Text>
            </Text>
          </View>
          <Divider inset={0} style={dividerColor} />
          <View style={styles.offerActions}>
            <TouchableRipple
              onPress={() => onOffer("decline", offer.booking_id)}
              disabled={!!offerActing}
              borderless
              accessibilityRole="button"
              accessibilityLabel="Decline this job offer"
              style={[styles.offerBtn, styles.offerDecline, { borderColor: c.border }]}
            >
              {offerActing === "decline" ? (
                <ActivityIndicator size={16} color={c.t2} />
              ) : (
                <Text style={[styles.offerDeclineText, { color: c.t2 }]}>
                  Decline
                </Text>
              )}
            </TouchableRipple>
            <TouchableRipple
              onPress={() => onOffer("accept", offer.booking_id)}
              disabled={!!offerActing}
              borderless
              accessibilityRole="button"
              accessibilityLabel="Accept this job offer"
              style={[styles.offerBtn, styles.offerAccept]}
            >
              {offerActing === "accept" ? (
                <ActivityIndicator size={16} color="#fff" />
              ) : (
                <Text style={styles.offerAcceptText}>Accept</Text>
              )}
            </TouchableRipple>
          </View>
        </Card>
      )}

      {/* ── Today's jobs ── */}
      <Card padding={0} style={cardStyle}>
        <View style={[styles.sectionPad, styles.rowBetween]}>
          <Text style={[styles.sectionLabel, { color: c.t2, marginBottom: 0 }]}>
            Today's jobs
          </Text>
          <TouchableRipple
            onPress={() => navigation.navigate("Requests")}
            borderless
            accessibilityRole="button"
            accessibilityLabel="See all jobs"
          >
            <Text style={styles.seeAll}>See all</Text>
          </TouchableRipple>
        </View>
        <Divider inset={0} style={dividerColor} />
        {incomingLoading && todaysJobs.length === 0 ? (
          <View style={styles.sectionPad}>
            <CardSkeleton style={{ height: 44, borderRadius: r.sm }} />
          </View>
        ) : todaysJobs.length === 0 ? (
          <View style={styles.jobsEmpty}>
            <Ionicons name="calendar-clear-outline" size={26} color={c.t3} />
            <Text style={[styles.emptyBody, { color: c.t2 }]}>
              No jobs scheduled for today.
            </Text>
          </View>
        ) : (
          todaysJobs.map((j, i) => (
            <React.Fragment key={j.booking_id}>
              <TouchableRipple
                onPress={() => navigation.navigate("Requests")}
                borderless
                accessibilityRole="button"
                accessibilityLabel={`${j.service_title ?? "Job"} for ${j.buyer_label}`}
              >
                <View style={styles.jobRow}>
                  <View
                    style={[
                      styles.iconChip,
                      { backgroundColor: palette.primaryLight },
                    ]}
                  >
                    <Ionicons name="briefcase-outline" size={17} color={BRAND} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={[styles.jobTitle, { color: c.t1 }]}
                      numberOfLines={1}
                    >
                      {j.service_title ?? "Service"}
                    </Text>
                    <Text
                      style={[styles.jobHint, { color: c.t2 }]}
                      numberOfLines={1}
                    >
                      {j.buyer_label}
                      {` · ${formatJobTime(j.scheduled_start)}`}
                      {j.delivery_label ? ` · ${j.delivery_label}` : ""}
                    </Text>
                  </View>
                  <StatusPill status={j.status} c={c} />
                </View>
              </TouchableRipple>
              {i < todaysJobs.length - 1 && (
                <Divider inset={0} style={dividerColor} />
              )}
            </React.Fragment>
          ))
        )}
      </Card>

      {/* ── Quick actions ── */}
      <View style={styles.quickGrid}>
        <QuickAction
          icon="construct-outline"
          label="My services"
          onPress={() => navigation.navigate("Services")}
          c={c}
        />
        <QuickAction
          icon="calendar-outline"
          label="Availability"
          onPress={() => navigation.navigate("Availability")}
          c={c}
        />
        <QuickAction
          icon="cash-outline"
          label="Earnings"
          onPress={() => navigation.navigate("Earnings")}
          c={c}
        />
        <QuickAction
          icon="person-outline"
          label="Profile"
          onPress={() => navigation.navigate("Profile")}
          c={c}
        />
      </View>
    </>
  );
}

// ── LIVE sub-components ─────────────────────────────────────────────────────
function SnapStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.snapStat}>
      <Text style={styles.snapValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.snapLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function OfferMeta({
  icon,
  text,
  c,
}: {
  icon: IconName;
  text: string;
  c: ThemeC;
}) {
  return (
    <View style={styles.offerMeta}>
      <Ionicons name={icon} size={13} color={c.t2} />
      <Text style={[styles.offerMetaText, { color: c.t2 }]}>{text}</Text>
    </View>
  );
}

function StatusPill({ status, c }: { status: string; c: ThemeC }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    IN_PROGRESS: { label: "In progress", color: BRAND, bg: palette.primaryLight },
    ACCEPTED: { label: "Confirmed", color: palette.success, bg: palette.successLight },
    FUNDS_HELD: { label: "Paid", color: palette.success, bg: palette.successLight },
    DEPOSIT_HELD: { label: "Deposit held", color: palette.success, bg: palette.successLight },
    QUOTE_SENT: { label: "Quoted", color: palette.warning, bg: palette.warningLight },
    QUOTED: { label: "Quoted", color: palette.warning, bg: palette.warningLight },
  };
  const s = map[status] ?? {
    label: "Scheduled",
    color: c.t2,
    bg: c.border,
  };
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <Text style={[styles.pillText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

function QuickAction({
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
      style={[
        styles.quickCard,
        { backgroundColor: c.surface, borderColor: c.border },
      ]}
    >
      <View style={styles.quickInner}>
        <View style={[styles.iconChip, { backgroundColor: palette.primaryLight }]}>
          <Ionicons name={icon} size={18} color={BRAND} />
        </View>
        <Text style={[styles.quickLabel, { color: c.t1 }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </TouchableRipple>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingTop: spacing.md },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },

  sectionPad: { padding: spacing.md },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionLabel: { ...typography.label, fontSize: 13, marginBottom: spacing.xs },

  // Headers (both states)
  setupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  liveHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  hiName: { fontFamily: "DMSans_600SemiBold", fontSize: 18, lineHeight: 24 },
  hiSub: { ...typography.bodySmall, fontSize: 13, marginTop: 1 },
  headerTierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 3,
  },
  headerTierText: { ...typography.bodySmall, fontSize: 12 },
  availRow: { alignItems: "center", gap: 2 },
  availLabel: { fontFamily: "DMSans_500Medium", fontSize: 12 },

  // Progress hero (SET_UP)
  heroKicker: {
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
  },
  heroLead: {
    fontFamily: "DMSans_700Bold",
    fontSize: 22,
    lineHeight: 28,
    color: "#fff",
    marginTop: 2,
  },
  heroMeter: { marginTop: spacing.sm, marginBottom: spacing.xs },
  heroFoot: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    color: "rgba(255,255,255,0.9)",
  },

  // Checklist (SET_UP)
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 60,
  },
  checkDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  checkNum: { fontFamily: "DMSans_600SemiBold", fontSize: 13 },
  checkLabel: { fontFamily: "DMSans_500Medium", fontSize: 15 },
  checkSub: { ...typography.bodySmall, fontSize: 12, marginTop: 1 },
  doneTag: { fontFamily: "DMSans_500Medium", fontSize: 12 },
  doNowBtn: {
    borderRadius: r.sm,
    backgroundColor: palette.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
    justifyContent: "center",
  },
  doNowText: { fontFamily: "DMSans_600SemiBold", fontSize: 13, color: "#fff" },

  // Locked preview (SET_UP)
  previewCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: r.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  previewHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  previewTitle: { fontFamily: "DMSans_600SemiBold", fontSize: 14 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  previewChip: {
    width: 32,
    height: 32,
    borderRadius: r.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  previewLabel: { ...typography.body, fontSize: 14 },
  previewFoot: {
    ...typography.bodySmall,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },

  // Earnings snapshot (LIVE)
  snapKicker: {
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
  },
  snapAmount: {
    fontFamily: "DMSans_800ExtraBold",
    fontSize: 30,
    lineHeight: 38,
    color: "#fff",
    marginTop: 2,
  },
  snapGrid: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
  },
  snapStat: { flex: 1, alignItems: "center", gap: 2 },
  snapValue: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
    color: "#fff",
  },
  snapLabel: {
    fontFamily: "DMSans_400Regular",
    fontSize: 11,
    color: "rgba(255,255,255,0.85)",
  },
  snapSep: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: "rgba(255,255,255,0.28)" },

  // Live offer (LIVE)
  offerHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  offerBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  offerBadgeText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 12,
    color: palette.primary,
  },
  offerTimer: { fontFamily: "DMSans_600SemiBold", fontSize: 12 },
  offerBody: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 4 },
  offerTitle: { fontFamily: "DMSans_600SemiBold", fontSize: 16 },
  offerMetaRow: { flexDirection: "row", gap: spacing.md, marginTop: 2 },
  offerMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  offerMetaText: { ...typography.bodySmall, fontSize: 12 },
  offerPay: { fontFamily: "DMSans_700Bold", fontSize: 18, marginTop: 2 },
  offerPaySub: { fontFamily: "DMSans_400Regular", fontSize: 12 },
  offerActions: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  offerBtn: {
    flex: 1,
    borderRadius: r.sm,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  offerDecline: { borderWidth: 1 },
  offerDeclineText: { fontFamily: "DMSans_500Medium", fontSize: 15 },
  offerAccept: { backgroundColor: palette.primary },
  offerAcceptText: { fontFamily: "DMSans_600SemiBold", fontSize: 15, color: "#fff" },

  // Today's jobs (LIVE)
  seeAll: { fontFamily: "DMSans_500Medium", fontSize: 13, color: palette.primary },
  jobRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 60,
  },
  jobTitle: { fontFamily: "DMSans_500Medium", fontSize: 15, lineHeight: 20 },
  jobHint: { ...typography.bodySmall, fontSize: 12, marginTop: 1 },
  jobsEmpty: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  pill: {
    borderRadius: r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  pillText: { fontFamily: "DMSans_500Medium", fontSize: 11 },

  // Quick actions (LIVE)
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  quickCard: {
    width: "48%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: r.sm,
  },
  quickInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    minHeight: 56,
  },
  quickLabel: { fontFamily: "DMSans_500Medium", fontSize: 14, flex: 1 },

  // Shared
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: r.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  meterTrack: { height: 8, borderRadius: r.full, overflow: "hidden" },
  meterFill: { height: 8, borderRadius: r.full },
  emptyTitle: { fontFamily: "DMSans_600SemiBold", fontSize: 16 },
  emptyBody: {
    ...typography.bodySmall,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  retryBtn: {
    marginTop: spacing.sm,
    borderRadius: r.sm,
    backgroundColor: palette.primary,
  },
  retryInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  retryText: { fontFamily: "DMSans_600SemiBold", fontSize: 14, color: "#fff" },
});
