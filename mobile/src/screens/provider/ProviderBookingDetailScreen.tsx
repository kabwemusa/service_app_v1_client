import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Button, Menu, Text, TouchableRipple } from "react-native-paper";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { storageUrl } from "../../api/client";
import {
  Booking,
  BookingStatus,
  TrustHint,
  bookingsApi,
} from "../../api/bookings";
import { ApiError } from "../../api/errors";
import { SafetyCategory, safetyReportsApi } from "../../api/safetyReports";
import { CardSkeleton } from "../../components/ui/SkeletonBlock";
import { ConfirmDialog, ConfirmDialogConfig } from "../../components/ui/ConfirmDialog";
import { useSnackbar } from "../../providers/SnackbarProvider";
import { useBookingStore } from "../../store/bookingStore";
import { useRealtimeStore } from "../../store/realtimeStore";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { BookingCommsSection } from "../../components/booking/BookingCommsSection";
import { JobTimerCard } from "../../components/booking/JobTimerCard";
import { palette, radius as r, spacing, typography } from "../../theme";

// ── Display maps ─────────────────────────────────────────────────────────────

const STATUS_META: Record<
  BookingStatus,
  { label: string; fg: string; bg: string }
> = {
  REQUESTED: {
    label: "Awaiting your response",
    fg: palette.warning,
    bg: palette.warningLight,
  },
  QUOTED: {
    label: "Quote sent",
    fg: palette.warning,
    bg: palette.warningLight,
  },
  ACCEPTED: {
    label: "Confirmed",
    fg: palette.primary,
    bg: palette.primaryLight,
  },
  IN_PROGRESS: {
    label: "In progress",
    fg: palette.primary,
    bg: palette.primaryLight,
  },
  DELIVERED: {
    label: "Awaiting customer confirm",
    fg: palette.secondary,
    bg: "#F7E9EF",
  },
  COMPLETED: {
    label: "Completed",
    fg: palette.success,
    bg: palette.successLight,
  },
  DISBURSED: {
    label: "Completed",
    fg: palette.success,
    bg: palette.successLight,
  },
  DECLINED: {
    label: "Declined",
    fg: palette.textSecondary,
    bg: palette.background,
  },
  EXPIRED: {
    label: "Expired",
    fg: palette.textSecondary,
    bg: palette.background,
  },
  CANCELLED: {
    label: "Cancelled",
    fg: palette.textSecondary,
    bg: palette.background,
  },
  NO_SHOW: { label: "No-show", fg: palette.danger, bg: palette.dangerLight },
  DISPUTED: { label: "Disputed", fg: palette.danger, bg: palette.dangerLight },
  PENDING_PAYMENT: {
    label: "Awaiting payment",
    fg: palette.warning,
    bg: palette.warningLight,
  },
  AWAITING_KYC: {
    label: "Awaiting verification",
    fg: palette.warning,
    bg: palette.warningLight,
  },
  FUNDS_HELD: {
    label: "Payment held",
    fg: palette.primary,
    bg: palette.primaryLight,
  },
  CHARGEBACK_PENDING: {
    label: "Chargeback",
    fg: palette.danger,
    bg: palette.dangerLight,
  },
  // Outcome-based pricing — quote-first models
  SCOPE_PENDING: {
    label: "Brief received — send your quote",
    fg: palette.warning,
    bg: palette.warningLight,
  },
  QUOTE_SENT: {
    label: "Quote sent — awaiting customer",
    fg: palette.warning,
    bg: palette.warningLight,
  },
  DEPOSIT_HELD: {
    label: "Deposit held",
    fg: palette.primary,
    bg: palette.primaryLight,
  },
  PAYMENT_FAILED: {
    label: "Customer payment failed",
    fg: palette.danger,
    bg: palette.dangerLight,
  },
};

// Qualitative buyer trust hint (§10.2) — never numeric, "new" styled neutrally (not a warning).
const TRUST_META: Record<
  TrustHint,
  { label: string; icon: keyof typeof Ionicons.glyphMap; fg: string }
> = {
  REPEAT_CLIENT: {
    label: "Repeat client",
    icon: "repeat-outline",
    fg: palette.success,
  },
  TRUSTED: {
    label: "Trusted customer",
    icon: "shield-checkmark-outline",
    fg: palette.success,
  },
  NEW: {
    label: "New customer",
    icon: "person-outline",
    fg: palette.textSecondary,
  },
};

const SAFETY_CATEGORIES: { label: string; value: SafetyCategory }[] = [
  { label: "Harassment", value: "HARASSMENT" },
  { label: "Violence / threat", value: "VIOLENCE_THREAT" },
  { label: "Unsafe behaviour", value: "UNSAFE_BEHAVIOR" },
  { label: "Discrimination", value: "DISCRIMINATION" },
  { label: "Stolen property", value: "STOLEN_PROPERTY" },
  { label: "Other", value: "OTHER" },
];

const STEP_LABELS = ["Accepted", "In progress", "Completed"] as const;
type StepState = "done" | "current" | "upcoming";

function stepStates(status: BookingStatus): StepState[] {
  switch (status) {
    case "ACCEPTED":
    case "FUNDS_HELD":   // ESCROW equivalent of ACCEPTED — booking is confirmed/funded
    case "DEPOSIT_HELD": // QUOTE_DEPOSIT — deposit custodied, job confirmed
      return ["done", "upcoming", "upcoming"];
    case "IN_PROGRESS":
      return ["done", "current", "upcoming"];
    case "DELIVERED":
      return ["done", "done", "current"];
    case "COMPLETED":
    case "DISBURSED":
      return ["done", "done", "done"];
    default:
      return ["upcoming", "upcoming", "upcoming"]; // pre-accept + terminal
  }
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-ZM", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function durationLabel(startIso: string, endIso: string): string | null {
  const mins = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000
  );
  if (!Number.isFinite(mins) || mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m} min`;
}

function countdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "auto-confirms shortly";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `auto-confirms in ${h}h ${m}m` : `auto-confirms in ${m}m`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function openDirections(lat: number, lng: number) {
  const latlng = `${lat},${lng}`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${latlng}`;
  const url = Platform.select({
    ios: `maps://?daddr=${latlng}`,
    android: `google.navigation:q=${latlng}`,
    default: web,
  })!;
  Linking.openURL(url).catch(() => Linking.openURL(web));
}

const WHATSAPP_NUMBER = (process.env.EXPO_PUBLIC_WHATSAPP_NUMBER ?? "").replace(/[^0-9]/g, "");

const CLOSED_FOR_PAYMENT: BookingStatus[] = [
  "CANCELLED",
  "DECLINED",
  "EXPIRED",
];
const TERMINAL: BookingStatus[] = [
  "CANCELLED",
  "DECLINED",
  "EXPIRED",
  "NO_SHOW",
  "DISPUTED",
];

export default function ProviderBookingDetailScreen({
  navigation,
  route,
}: any) {
  const bookingId: string = route.params?.bookingId;
  const insets = useSafeAreaInsets();
  const { showError, showSuccess } = useSnackbar();
  const {
    accept,
    quote,
    decline,
    start,
    deliver,
    requestCapExtension,
    cancel,
    markPaid,
    submitting,
    error,
    clearError,
  } = useBookingStore();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [dialog, setDialog] = useState<ConfirmDialogConfig | null>(null);

  // Quote entry — scoped quotes (PROVIDER_SCOPE / QUOTE_DEPOSIT) also carry
  // an estimated duration + note so the customer sees a complete offer.
  const [showQuote, setShowQuote] = useState(false);
  const [quotePrice, setQuotePrice] = useState("");
  const [quoteHours, setQuoteHours] = useState("");
  const [quoteNote, setQuoteNote] = useState("");

  // Safety report (§11.3)
  const [showSafety, setShowSafety] = useState(false);
  const [safetyCategory, setSafetyCat] = useState<SafetyCategory>("HARASSMENT");
  const [safetyText, setSafetyText] = useState("");
  const [tosAck, setTosAck] = useState(false);

  const busy = submitting || actionBusy;

  useEffect(() => {
    if (bookingId) loadBooking();
  }, [bookingId]);
  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  // Live refresh when a realtime event lands for THIS booking (customer paid,
  // cancelled, disputed…) — refetch instantly instead of requiring a reload.
  const rtRevision = useRealtimeStore((s) => s.bookingRevision);
  const rtLastBooking = useRealtimeStore((s) => s.lastBookingId);
  useEffect(() => {
    if (bookingId && rtLastBooking === bookingId) loadBooking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtRevision]);

  async function loadBooking() {
    if (!bookingId) return;
    try {
      setBooking(await bookingsApi.get(bookingId));
    } catch (e) {
      showError(e instanceof ApiError ? e.message : "Failed to load booking.");
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }

  async function runAction(action: () => Promise<Booking>) {
    setActionBusy(true);
    try {
      setBooking(await action());
    } catch (e) {
      showError(e instanceof ApiError ? e.message : "Action failed.");
    } finally {
      setActionBusy(false);
    }
  }

  function confirmAction(
    title: string,
    message: string,
    action: () => Promise<Booking>
  ) {
    setDialog({
      title,
      message,
      confirmLabel: "Confirm",
      onConfirm: () => { setDialog(null); runAction(action); },
    });
  }

  function notYetAvailable(feature: string) {
    setDialog({
      title: feature,
      message: "In-app messaging is coming soon. For now, arrange contact through your usual channel.",
      hideCancel: true,
      confirmLabel: "Got it",
      onConfirm: () => setDialog(null),
    });
  }

  async function submitQuote() {
    const price = Number(quotePrice);
    if (!Number.isFinite(price) || price <= 0) {
      showError("Enter a valid amount above ZMW 0.");
      return;
    }
    const hours = Number(quoteHours);
    await runAction(() =>
      quote(booking!.id, price, {
        ...(Number.isFinite(hours) && hours > 0 ? { duration_mins: Math.round(hours * 60) } : {}),
        ...(quoteNote.trim() ? { message: quoteNote.trim() } : {}),
      })
    );
    setShowQuote(false);
    setQuotePrice("");
    setQuoteHours("");
    setQuoteNote("");
  }

  async function submitSafety() {
    if (!booking) return;
    if (safetyText.trim().length < 20) {
      showError("Please describe the issue in at least 20 characters.");
      return;
    }
    if (!tosAck) {
      showError("Please acknowledge the terms before submitting.");
      return;
    }
    setActionBusy(true);
    try {
      await safetyReportsApi.file({
        reported_id: booking.buyer.id,
        booking_id: booking.id,
        category: safetyCategory,
        description: safetyText.trim(),
        tos_acknowledged: true,
      });
      setShowSafety(false);
      setSafetyText("");
      setTosAck(false);
      setDialog({
        title: "Report submitted",
        message: "Our moderation team will review this within 1 hour.",
        hideCancel: true,
        confirmLabel: "Done",
        onConfirm: () => setDialog(null),
      });
    } catch (e) {
      showError(e instanceof ApiError ? e.message : "Failed to submit report.");
    } finally {
      setActionBusy(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading || !booking) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <Header onBack={() => navigation.goBack()} onMenu={undefined} />
        <View style={styles.skeletons}>
          <CardSkeleton style={styles.skelSm} />
          <CardSkeleton style={styles.skelLg} />
          <CardSkeleton style={styles.skelMd} />
        </View>
      </SafeAreaView>
    );
  }

  const isDirect = (booking.payment_mode ?? "ESCROW") === "DIRECT";
  const meta = STATUS_META[booking.status];
  const steps = stepStates(booking.status);
  const buyerName =
    booking.buyer.name?.trim() || booking.buyer.email.split("@")[0];
  const trust = booking.buyer.trust_hint
    ? TRUST_META[booking.buyer.trust_hint]
    : null;
  const basePrice = booking.service.base_price ?? 0;
  const total = booking.agreed_amount ?? booking.amount ?? basePrice;
  const hasCoords =
    booking.delivery_lat != null && booking.delivery_lng != null;
  const cancellable = ["REQUESTED", "QUOTED", "ACCEPTED"].includes(
    booking.status
  );

  const providerPaid = !!booking.provider_marked_paid_at;
  const customerPaid = !!booking.customer_marked_paid_at;
  const fullySettled = providerPaid && customerPaid;
  // Mark Paid is a DIRECT-mode-only concept (the two-party "I paid" / "I
  // received it" handshake for cash/manual MoMo transfers). ESCROW bookings
  // are already settled through the payment hold — the backend rejects
  // markPaid for them ("only available for legacy DIRECT bookings").
  const canMarkPaid =
    isDirect && !CLOSED_FOR_PAYMENT.includes(booking.status) && !providerPaid;

  const isHourly = booking.service.pricing_model === "HOURLY_CAPPED";

  // "Finish" — HOURLY_CAPPED stops the observed timer; the elapsed time is
  // computed server-side from the start/stop timestamps (no hours are entered),
  // billed only for time worked and capped at the customer's approved amount.
  function handleFinish() {
    if (isHourly) {
      confirmAction(
        "Finish job",
        "Stop the timer and finish? We bill only the time worked (from when you started), rounded up to your increment and capped at the customer's approved amount.",
        () => deliver(booking!.id)
      );
      return;
    }
    confirmAction(
      "Mark as complete",
      "Mark this job complete? The customer is asked to confirm; it auto-confirms after the confirmation window.",
      () => deliver(booking!.id)
    );
  }

  // "Need more time" — asks the customer to authorise a higher hold. The cap is
  // never silently exceeded; the customer re-authorises via PawaPay.
  function handleNeedMoreTime() {
    confirmAction(
      "Ask for more time",
      `Let ${buyerName} know you need more time. They approve the extra amount before the cap is raised — nothing is charged beyond what they authorise.`,
      () => requestCapExtension(booking!.id)
    );
  }

  // Masked call — routes through the proxy; neither party sees the other's
  // number. Available only inside the funded/active window (server-gated).
  const callEnabled = !!booking.comms?.call_enabled;
  async function startMaskedCall() {
    if (busy) return;
    setActionBusy(true);
    try {
      const res = await bookingsApi.call(booking!.id);
      showSuccess(res.message);
      if (res.mode === "reveal" && res.revealed_number) {
        Linking.openURL(`tel:${res.revealed_number}`).catch(() => {});
      }
    } catch (e) {
      showError(e instanceof ApiError ? e.message : "Could not start the call.");
    } finally {
      setActionBusy(false);
    }
  }

  // "On my way" nudge — one tap sends the structured update to the customer and
  // lights up the "On the way" step on their screen.
  const sentOnMyWay = ["ON_MY_WAY", "ARRIVED"].includes(booking.last_update?.type ?? "");
  function sendOnMyWay() {
    runAction(() => bookingsApi.statusUpdate(booking!.id, "ON_MY_WAY"));
  }

  function openWhatsApp() {
    if (!WHATSAPP_NUMBER) {
      notYetAvailable("Message customer");
      return;
    }
    const ref = booking!.id.slice(0, 8).toUpperCase();
    const text = encodeURIComponent(`Hi, about our booking (ref ${ref}).`);
    Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`).catch(() =>
      showError("Could not open WhatsApp.")
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Header
        onBack={() => navigation.goBack()}
        onMenu={() => setMenuOpen(true)}
        menuOpen={menuOpen}
        onMenuDismiss={() => setMenuOpen(false)}
        menuItems={[
          ...(cancellable
            ? [
                {
                  label: "Cancel job",
                  danger: true,
                  onPress: () => {
                    setMenuOpen(false);
                    confirmAction(
                      "Cancel job",
                      booking.status === "ACCEPTED"
                        ? "Cancelling a confirmed job may affect your cancellation rate. Continue?"
                        : "Cancel this booking? The customer will be notified.",
                      () => cancel(booking.id)
                    );
                  },
                },
              ]
            : []),
          {
            label: "Report an issue",
            danger: true,
            onPress: () => {
              setMenuOpen(false);
              setShowSafety(true);
            },
          },
        ]}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Title + live status banner (amber while upcoming, with a nudge) */}
        <Text style={styles.title}>{booking.service.title}</Text>
        <ProviderStatusBanner
          booking={booking}
          buyerName={buyerName}
          busy={busy}
          onSendOnMyWay={sentOnMyWay ? undefined : sendOnMyWay}
        />

        {/* Stepper */}
        <Stepper steps={steps} />

        {/* SCREEN 3 — live, mutually-visible job timer while in progress */}
        {booking.status === "IN_PROGRESS" && (
          <View style={styles.timerWrap}>
            <JobTimerCard
              booking={booking}
              role="provider"
              busy={busy}
              firstName={buyerName}
              onFinish={handleFinish}
              onNeedMoreTime={isHourly ? handleNeedMoreTime : undefined}
            />
          </View>
        )}

        <Divider />

        {/* 1 — Customer */}
        <Text style={styles.sectionLabel}>Customer</Text>
        <View style={styles.customerRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(buyerName)}</Text>
          </View>
          <View style={styles.customerInfo}>
            <Text style={styles.customerName} numberOfLines={1}>
              {buyerName}
            </Text>
            {trust && (
              <View style={styles.trustRow}>
                <Ionicons name={trust.icon} size={13} color={trust.fg} />
                <Text style={[styles.trustText, { color: trust.fg }]}>
                  {trust.label}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.contactRow}>
          <Button
            mode="outlined"
            icon="whatsapp"
            style={styles.contactBtn}
            contentStyle={styles.contactBtnContent}
            textColor={palette.primary}
            onPress={openWhatsApp}
            accessibilityLabel="Message customer on WhatsApp"
          >
            Message
          </Button>
          <Button
            mode="outlined"
            icon="phone-outline"
            style={styles.contactBtn}
            contentStyle={styles.contactBtnContent}
            textColor={callEnabled ? palette.primary : palette.textDisabled}
            disabled={!callEnabled || busy}
            onPress={startMaskedCall}
            accessibilityLabel="Call customer through a private masked line"
          >
            Call
          </Button>
        </View>
        {callEnabled && (
          <Text style={styles.contactHint}>
            Calls connect through a private line — your number stays hidden.
          </Text>
        )}

        <Divider />

        {/* 2 — Service & payment */}
        <Text style={styles.sectionLabel}>Service & payment</Text>
        <LineItem label={booking.service.title} value={basePrice} />
        {booking.agreed_amount != null &&
          booking.agreed_amount !== basePrice && (
            <LineItem
              label="Price agreed with customer"
              value={booking.agreed_amount}
              muted
            />
          )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>ZMW {total.toFixed(2)}</Text>
        </View>

        {/* Payment block — payment_mode-aware */}
        {isDirect ? (
          <View style={[styles.payBlock, fullySettled && styles.payBlockDone]}>
            {fullySettled ? (
              <>
                <View style={styles.payHeadRow}>
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={palette.success}
                  />
                  <Text style={[styles.payHead, { color: palette.success }]}>
                    Paid · settled
                  </Text>
                </View>
                <Text style={styles.paySub}>
                  Both you and the customer confirmed this was paid directly.
                </Text>
              </>
            ) : (
              <>
                <View style={styles.payHeadRow}>
                  <Ionicons
                    name="cash-outline"
                    size={18}
                    color={palette.primary}
                  />
                  <Text style={styles.payHead}>
                    Collect ZMW {total.toFixed(2)} directly
                  </Text>
                </View>
                <Text style={styles.paySub}>
                  You keep the full amount — no commission is charged. Payment
                  is arranged directly with the customer.
                </Text>
                {(providerPaid || customerPaid) && (
                  <Text style={styles.payStatusLine}>
                    {providerPaid &&
                      !customerPaid &&
                      "You marked paid · awaiting customer confirmation"}
                    {!providerPaid &&
                      customerPaid &&
                      "Customer marked paid · confirm once you’ve received it"}
                  </Text>
                )}
              </>
            )}
          </View>
        ) : (
          <View style={styles.payBlock}>
            <View style={styles.payHeadRow}>
              <Ionicons
                name={["COMPLETED", "DISBURSED"].includes(booking.status) ? "checkmark-circle" : "lock-closed-outline"}
                size={18}
                color={["COMPLETED", "DISBURSED"].includes(booking.status) ? palette.success : palette.primary}
              />
              <Text style={styles.payHead}>
                {["COMPLETED", "DISBURSED"].includes(booking.status)
                  ? "Payout released"
                  : "You'll be paid when confirmed done"}
              </Text>
            </View>

            {/* Server-computed earnings: job price − platform fee = net payout. */}
            {booking.earnings ? (
              <>
                <View style={styles.earnRow}>
                  <Text style={styles.earnLabel}>Job price</Text>
                  <Text style={styles.earnValue}>ZMW {booking.earnings.gross.toFixed(2)}</Text>
                </View>
                <View style={styles.earnRow}>
                  <Text style={styles.earnLabel}>
                    Platform fee ({Math.round(booking.earnings.commission_rate * 100)}%)
                  </Text>
                  <Text style={styles.earnValue}>− ZMW {booking.earnings.platform_fee.toFixed(2)}</Text>
                </View>
                <View style={styles.earnNetRow}>
                  <Text style={styles.earnNetLabel}>Your payout</Text>
                  <Text style={styles.earnNetValue}>ZMW {booking.earnings.net_payout.toFixed(2)}</Text>
                </View>
              </>
            ) : (
              <LineItem label="Total" value={total} />
            )}

            <Text style={styles.paySub}>
              {["COMPLETED", "DISBURSED"].includes(booking.status)
                ? "Paid to your Mobile Money."
                : "Held safely — paid to your Mobile Money once the customer confirms the job is done."}
            </Text>
          </View>
        )}

        <Divider />

        {/* 3 — Schedule */}
        <Text style={styles.sectionLabel}>Schedule</Text>
        <View style={styles.iconLine}>
          <Ionicons
            name="calendar-outline"
            size={16}
            color={palette.textSecondary}
          />
          <Text style={styles.iconLineText}>
            {fmtDateTime(booking.scheduled_start)}
          </Text>
        </View>
        {durationLabel(booking.scheduled_start, booking.scheduled_end) && (
          <View style={styles.iconLine}>
            <Ionicons
              name="time-outline"
              size={16}
              color={palette.textSecondary}
            />
            <Text style={styles.iconLineText}>
              Estimated duration ·{" "}
              {durationLabel(booking.scheduled_start, booking.scheduled_end)}
            </Text>
          </View>
        )}

        <Divider />

        {/* 4 — Location (label only, never coordinates). Remote jobs show "Online". */}
        <Text style={styles.sectionLabel}>{booking.is_remote ? 'Delivery' : 'Location'}</Text>
        <View style={styles.iconLine}>
          <Ionicons
            name={booking.is_remote ? 'globe-outline' : 'location-outline'}
            size={16}
            color={palette.textSecondary}
          />
          <Text style={styles.iconLineText}>
            {booking.is_remote
              ? 'Delivered online — no travel needed'
              : (booking.delivery_location_label ??
                booking.delivery_location_region ??
                "Location shared on the map")}
          </Text>
        </View>
        {hasCoords && (
          <Button
            mode="outlined"
            icon="navigation-variant-outline"
            style={styles.directionsBtn}
            contentStyle={styles.contactBtnContent}
            textColor={palette.primary}
            onPress={() =>
              openDirections(booking.delivery_lat!, booking.delivery_lng!)
            }
            accessibilityLabel="Open directions to the customer location"
          >
            Go
          </Button>
        )}

        {/* Customer's structured brief (quote-first models) */}
        {!!booking.scope_brief?.length && (
          <>
            <Divider />
            <Text style={styles.sectionLabel}>Customer's brief</Text>
            {booking.scope_brief.map((qa, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <Text style={[styles.notesText, { color: palette.textSecondary, fontSize: 12 }]}>
                  {qa.question}
                </Text>
                <Text style={styles.notesText}>{qa.answer}</Text>
              </View>
            ))}
            {!!booking.scope_brief_attachments?.length && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.briefMediaRow}
              >
                {booking.scope_brief_attachments.map((att, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.briefMediaThumb}
                    onPress={() => Linking.openURL(storageUrl(att.path))}
                    accessibilityRole="button"
                    accessibilityLabel={att.type === "video" ? "Open video the customer attached" : "Open photo the customer attached"}
                  >
                    <Image
                      source={{ uri: storageUrl(att.path) }}
                      style={styles.briefMediaImg}
                      contentFit="cover"
                    />
                    {att.type === "video" && (
                      <View style={styles.briefMediaPlayBadge}>
                        <Ionicons name="play" size={14} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </>
        )}

        {/* 5 — Customer notes (only if present) */}
        {!!booking.notes?.trim() && (
          <>
            <Divider />
            <Text style={styles.sectionLabel}>Customer notes</Text>
            <Text style={styles.notesText}>{booking.notes.trim()}</Text>
          </>
        )}

        <Divider />

        {/* 6 — Report an issue (§11.3) */}
        {!showSafety ? (
          <TouchableRipple
            onPress={() => setShowSafety(true)}
            borderless
            style={styles.reportRow}
            accessibilityRole="button"
            accessibilityLabel="Report an issue"
          >
            <View style={styles.reportInner}>
              <Ionicons name="flag-outline" size={18} color={palette.danger} />
              <Text style={styles.reportText}>Report an issue</Text>
            </View>
          </TouchableRipple>
        ) : (
          <View style={styles.safetyForm}>
            <Text style={[styles.sectionLabel, { color: palette.danger }]}>
              Report an issue
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: spacing.sm }}
            >
              <View style={styles.chipRow}>
                {SAFETY_CATEGORIES.map((c) => (
                  <TouchableRipple
                    key={c.value}
                    onPress={() => setSafetyCat(c.value)}
                    borderless
                    style={[
                      styles.chip,
                      safetyCategory === c.value && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        safetyCategory === c.value && styles.chipTextActive,
                      ]}
                    >
                      {c.label}
                    </Text>
                  </TouchableRipple>
                ))}
              </View>
            </ScrollView>
            <TextInput
              style={styles.textArea}
              multiline
              numberOfLines={4}
              placeholder="Describe what happened (min. 20 characters)"
              placeholderTextColor={palette.textDisabled}
              value={safetyText}
              onChangeText={setSafetyText}
            />
            <TouchableRipple
              onPress={() => setTosAck(!tosAck)}
              borderless
              style={styles.tosRow}
            >
              <View style={styles.tosInner}>
                <Ionicons
                  name={tosAck ? "checkbox" : "square-outline"}
                  size={20}
                  color={tosAck ? palette.danger : palette.textSecondary}
                />
                <Text style={styles.tosText}>
                  I understand that filing a false report may restrict my
                  account.
                </Text>
              </View>
            </TouchableRipple>
            <Button
              mode="contained"
              buttonColor={palette.danger}
              style={styles.safetyBtn}
              contentStyle={styles.payBtnContent}
              labelStyle={styles.btnLabel}
              loading={busy}
              disabled={busy || safetyText.trim().length < 20 || !tosAck}
              onPress={submitSafety}
            >
              Submit report
            </Button>
            <Button
              mode="text"
              textColor={palette.textSecondary}
              onPress={() => setShowSafety(false)}
            >
              Cancel
            </Button>
          </View>
        )}

        {/* Communication layer — masked call + status updates + agreement download */}
        <View style={{ paddingHorizontal: spacing.md }}>
          <BookingCommsSection booking={booking} onChanged={loadBooking} />
        </View>
      </ScrollView>

      {/* Sticky, state-driven action bar */}
      <ActionBar
        booking={booking}
        insetBottom={insets.bottom}
        busy={busy}
        buyerName={buyerName}
        onAccept={() =>
          confirmAction(
            "Accept request",
            `Accept this booking at ZMW ${total.toFixed(
              2
            )}? This confirms the job — the customer pays you directly.`,
            () => accept(booking.id)
          )
        }
        onQuote={() => {
          setQuotePrice(String(booking.amount ?? basePrice ?? ""));
          setShowQuote(true);
        }}
        onDecline={() =>
          confirmAction(
            "Decline request",
            "Decline this booking? The customer will be notified.",
            () => decline(booking.id)
          )
        }
        onStart={() => runAction(() => start(booking.id))}
        onComplete={handleFinish}
        onMarkPaid={
          canMarkPaid
            ? () =>
                confirmAction(
                  "Mark as paid",
                  "Confirm you've received payment directly from the customer. This records your side only — the booking shows as settled once the customer also confirms.",
                  () => markPaid(booking.id)
                )
            : undefined
        }
        onAskReview={() => notYetAvailable("Ask for a review")}
      />

      {/* Quote entry — scoped quote (price + duration + note) for quote-first
          models; plain alternate price for the rest. */}
      {showQuote && (
        <View style={styles.quoteOverlay}>
          <View style={styles.quoteSheet}>
            <Text style={styles.quoteTitle}>Send a quote</Text>
            <Text style={styles.quoteSub}>
              {booking.status === "SCOPE_PENDING"
                ? "Quote against the customer's brief. They approve before any money is held."
                : (booking.payment_mode ?? "ESCROW") === "DIRECT"
                ? "Propose your price. The customer pays you directly if they accept."
                : "Propose your price. Funds are held in escrow once the customer accepts."}
            </Text>
            <View style={styles.quoteInputRow}>
              <Text style={styles.quoteCurrency}>ZMW</Text>
              <TextInput
                style={styles.quoteInput}
                keyboardType="numeric"
                autoFocus
                value={quotePrice}
                onChangeText={(t) => setQuotePrice(t.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                placeholderTextColor={palette.textDisabled}
              />
            </View>
            <View style={styles.quoteInputRow}>
              <Ionicons name="time-outline" size={16} color={palette.textSecondary} />
              <TextInput
                style={styles.quoteInput}
                keyboardType="numeric"
                value={quoteHours}
                onChangeText={(t) => setQuoteHours(t.replace(/[^0-9.]/g, ""))}
                placeholder="Estimated hours (optional)"
                placeholderTextColor={palette.textDisabled}
              />
            </View>
            <TextInput
              style={styles.quoteNoteInput}
              value={quoteNote}
              onChangeText={setQuoteNote}
              placeholder="What's included / note to the customer (optional)"
              placeholderTextColor={palette.textDisabled}
              multiline
            />
            {booking.service.pricing_model === "QUOTE_DEPOSIT" && Number(quotePrice) > 0 && (
              <Text style={styles.quoteSub}>
                Deposit ({booking.service.deposit_percent ?? 30}%): ZMW{" "}
                {((Number(quotePrice) * (booking.service.deposit_percent ?? 30)) / 100).toFixed(0)} now ·
                balance collected at completion.
              </Text>
            )}
            <View style={styles.quoteActions}>
              <Button
                mode="text"
                textColor={palette.textSecondary}
                onPress={() => setShowQuote(false)}
              >
                Cancel
              </Button>
              <Button
                mode="contained"
                loading={busy}
                disabled={busy || !(Number(quotePrice) > 0)}
                onPress={submitQuote}
              >
                Send quote
              </Button>
            </View>
          </View>
        </View>
      )}

      <ConfirmDialog dialog={dialog} busy={actionBusy} onDismiss={() => setDialog(null)} />
    </SafeAreaView>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────
function Header({
  onBack,
  onMenu,
  menuOpen,
  onMenuDismiss,
  menuItems,
}: {
  onBack: () => void;
  onMenu?: () => void;
  menuOpen?: boolean;
  onMenuDismiss?: () => void;
  menuItems?: { label: string; onPress: () => void; danger?: boolean }[];
}) {
  const menuBtn = onMenu ? (
    <Menu
      visible={!!menuOpen}
      onDismiss={onMenuDismiss ?? (() => {})}
      anchor={
        <TouchableRipple
          onPress={onMenu}
          borderless
          style={styles.iconBtn}
          accessibilityLabel="More options"
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={palette.textPrimary} />
        </TouchableRipple>
      }
    >
      {(menuItems ?? []).map((item) => (
        <Menu.Item
          key={item.label}
          onPress={item.onPress}
          title={item.label}
          titleStyle={item.danger ? { color: palette.danger } : undefined}
        />
      ))}
    </Menu>
  ) : undefined;

  return <ScreenHeader title="Booking" back onBack={onBack} right={menuBtn} />;
}

// ── Provider status banner ───────────────────────────────────────────────────
function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 24) return `in ${Math.round(h / 24)} day${h >= 48 ? "s" : ""}`;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

function ProviderStatusBanner({
  booking,
  buyerName,
  busy,
  onSendOnMyWay,
}: {
  booking: Booking;
  buyerName: string;
  busy: boolean;
  onSendOnMyWay?: () => void;
}) {
  const s = booking.status;
  const upcoming = ["FUNDS_HELD", "DEPOSIT_HELD", "ACCEPTED"].includes(s);

  let tone: { bg: string; fg: string } = { bg: palette.warningLight, fg: palette.warning };
  let icon: keyof typeof Ionicons.glyphMap = "time-outline";
  let title = STATUS_META[s].label;
  let sub: string | null = null;

  if (upcoming) {
    tone = { bg: palette.warningLight, fg: palette.warning };
    icon = "calendar-outline";
    title = booking.scheduled_start ? `Starts ${timeUntil(booking.scheduled_start)}` : "Upcoming job";
    sub = `Let ${buyerName} know you're on the way.`;
  } else if (s === "IN_PROGRESS") {
    tone = { bg: palette.primaryLight, fg: palette.primary };
    icon = "construct-outline";
    title = "Job in progress";
    sub = "The timer is running — both of you can see it.";
  } else if (s === "DELIVERED") {
    tone = { bg: "#F7E9EF", fg: palette.secondary };
    icon = "hourglass-outline";
    title = `Waiting for ${buyerName} to confirm`;
  } else if (s === "COMPLETED" || s === "DISBURSED") {
    tone = { bg: palette.successLight, fg: palette.success };
    icon = "checkmark-circle";
    title = "Completed";
  }

  return (
    <View style={[styles.banner, { backgroundColor: tone.bg }]} accessibilityLabel={`${title}${sub ? `. ${sub}` : ""}`}>
      <View style={styles.bannerMain}>
        <Ionicons name={icon} size={22} color={tone.fg} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.bannerTitle, { color: tone.fg }]}>{title}</Text>
          {!!sub && <Text style={styles.bannerSub}>{sub}</Text>}
        </View>
      </View>
      {upcoming && onSendOnMyWay && (
        <Button
          mode="contained"
          compact
          icon="navigation-variant-outline"
          style={styles.bannerAction}
          labelStyle={styles.bannerActionLabel}
          loading={busy}
          disabled={busy}
          onPress={onSendOnMyWay}
        >
          I'm on my way
        </Button>
      )}
    </View>
  );
}

// ── Stepper ──────────────────────────────────────────────────────────────────
function Stepper({ steps }: { steps: StepState[] }) {
  const currentLabel =
    STEP_LABELS[steps.findIndex((s) => s === "current")] ?? null;
  const summary = currentLabel
    ? `Current step: ${currentLabel}`
    : steps.every((s) => s === "done")
    ? "All steps complete"
    : "Not started";
  return (
    <View style={styles.stepper} accessibilityLabel={summary}>
      {STEP_LABELS.map((label, i) => {
        const st = steps[i];
        return (
          <React.Fragment key={label}>
            <View style={styles.stepNode}>
              <View
                style={[
                  styles.stepCircle,
                  st === "done" && styles.stepCircleDone,
                  st === "current" && styles.stepCircleCurrent,
                ]}
              >
                {st === "done" ? (
                  <Ionicons name="checkmark" size={14} color="#fff" />
                ) : (
                  <Text
                    style={[
                      styles.stepNum,
                      st === "current" && styles.stepNumCurrent,
                    ]}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  st !== "upcoming" && styles.stepLabelActive,
                ]}
                numberOfLines={1}
              >
                {label}
                {st === "current" ? " ·" : ""}
              </Text>
            </View>
            {i < STEP_LABELS.length - 1 && (
              <View
                style={[
                  styles.stepConnector,
                  steps[i] === "done" && styles.stepConnectorDone,
                ]}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

// ── Action bar ───────────────────────────────────────────────────────────────
function ActionBar({
  booking,
  insetBottom,
  busy,
  buyerName,
  onAccept,
  onQuote,
  onDecline,
  onStart,
  onComplete,
  onMarkPaid,
  onAskReview,
}: {
  booking: Booking;
  insetBottom: number;
  busy: boolean;
  buyerName: string;
  onAccept: () => void;
  onQuote: () => void;
  onDecline: () => void;
  onStart: () => void;
  onComplete: () => void;
  onMarkPaid?: () => void;
  onAskReview: () => void;
}) {
  const status = booking.status;
  const isDirect = (booking.payment_mode ?? "ESCROW") === "DIRECT";
  const total =
    booking.agreed_amount ?? booking.amount ?? booking.service.base_price ?? 0;

  let content: React.ReactNode = null;

  if (status === "REQUESTED") {
    // DIRECT: the provider's Accept confirms the booking (the customer pays later).
    // ESCROW: the customer funds the request — the provider can't "accept" it, only
    // send an alternate quote or decline. Funding moves it straight to FUNDS_HELD.
    content = isDirect ? (
      <>
        <Button
          mode="contained"
          style={styles.primaryBtn}
          contentStyle={styles.primaryBtnContent}
          labelStyle={styles.btnLabel}
          loading={busy}
          disabled={busy}
          onPress={onAccept}
        >
          Accept · ZMW {total.toFixed(0)}
        </Button>
        <View style={styles.barRow}>
          <Button
            mode="outlined"
            style={styles.barRowBtn}
            contentStyle={styles.primaryBtnContent}
            textColor={palette.primary}
            disabled={busy}
            onPress={onQuote}
          >
            Send a quote
          </Button>
          <Button
            mode="outlined"
            style={[styles.barRowBtn, { borderColor: palette.danger }]}
            contentStyle={styles.primaryBtnContent}
            textColor={palette.danger}
            disabled={busy}
            onPress={onDecline}
          >
            Decline
          </Button>
        </View>
      </>
    ) : (
      <>
        <PassiveNote
          icon="hourglass-outline"
          text={`New request · ${buyerName} is funding it into escrow. Send a quote if the price should differ.`}
        />
        <View style={styles.barRow}>
          <Button
            mode="outlined"
            style={styles.barRowBtn}
            contentStyle={styles.primaryBtnContent}
            textColor={palette.primary}
            disabled={busy}
            onPress={onQuote}
          >
            Send a quote
          </Button>
          <Button
            mode="outlined"
            style={[styles.barRowBtn, { borderColor: palette.danger }]}
            contentStyle={styles.primaryBtnContent}
            textColor={palette.danger}
            disabled={busy}
            onPress={onDecline}
          >
            Decline
          </Button>
        </View>
      </>
    );
  } else if (status === "SCOPE_PENDING") {
    // Quote-first: the customer's brief is in — quoting wins (or loses) the job.
    content = (
      <>
        <Button
          mode="contained"
          style={styles.primaryBtn}
          contentStyle={styles.primaryBtnContent}
          labelStyle={styles.btnLabel}
          loading={busy}
          disabled={busy}
          onPress={onQuote}
        >
          Review brief & send quote
        </Button>
        <Button
          mode="outlined"
          style={[styles.secondaryBtn, { borderColor: palette.danger }]}
          contentStyle={styles.primaryBtnContent}
          textColor={palette.danger}
          disabled={busy}
          onPress={onDecline}
        >
          Decline
        </Button>
      </>
    );
  } else if (status === "QUOTE_SENT") {
    content = (
      <PassiveNote
        icon="hourglass-outline"
        text={`Quote sent · ${buyerName} will approve and pay before anything starts. Nothing is charged until then.`}
      />
    );
  } else if (status === "QUOTED") {
    content = (
      <PassiveNote
        icon="hourglass-outline"
        text={`Quote sent · waiting for ${buyerName} to accept${isDirect ? "" : " and pay"}.`}
      />
    );
  } else if (status === "ACCEPTED" || status === "FUNDS_HELD" || status === "DEPOSIT_HELD") {
    content = (
      <Button
        mode="contained"
        style={styles.primaryBtn}
        contentStyle={styles.primaryBtnContent}
        labelStyle={styles.btnLabel}
        loading={busy}
        disabled={busy}
        onPress={onStart}
      >
        Start job
      </Button>
    );
  } else if (status === "IN_PROGRESS") {
    // Finish / Need-more-time live on the JobTimerCard above — no bar CTA here.
    content = null;
  } else if (status === "DELIVERED") {
    content = (
      <>
        {onMarkPaid && (
          <Button
            mode="contained"
            style={styles.primaryBtn}
            contentStyle={styles.primaryBtnContent}
            labelStyle={styles.btnLabel}
            loading={busy}
            disabled={busy}
            onPress={onMarkPaid}
          >
            Mark paid
          </Button>
        )}
        <PassiveNote
          icon="hourglass-outline"
          text={`Waiting for ${buyerName} to confirm${
            booking.auto_release_at
              ? ` · ${countdown(booking.auto_release_at)}`
              : ""
          }.`}
        />
      </>
    );
  } else if (status === "COMPLETED" || status === "DISBURSED") {
    content = (
      <>
        {onMarkPaid && (
          <Button
            mode="contained"
            style={styles.primaryBtn}
            contentStyle={styles.primaryBtnContent}
            labelStyle={styles.btnLabel}
            loading={busy}
            disabled={busy}
            onPress={onMarkPaid}
          >
            Mark paid
          </Button>
        )}
        <Button
          mode={onMarkPaid ? "outlined" : "contained"}
          style={onMarkPaid ? styles.secondaryBtn : styles.primaryBtn}
          contentStyle={styles.primaryBtnContent}
          labelStyle={styles.btnLabel}
          textColor={onMarkPaid ? palette.primary : undefined}
          icon="star-outline"
          disabled={busy}
          onPress={onAskReview}
        >
          Ask for a review
        </Button>
      </>
    );
  } else if (TERMINAL.includes(status)) {
    content = (
      <PassiveNote
        icon="information-circle-outline"
        text={
          status === "NO_SHOW"
            ? "Marked as a no-show."
            : `This booking is ${STATUS_META[status].label.toLowerCase()}.`
        }
      />
    );
  }

  if (!content) return null;
  return (
    <View
      style={[styles.actionBar, { paddingBottom: insetBottom + spacing.sm }]}
    >
      {content}
    </View>
  );
}

function PassiveNote({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.passive}>
      <Ionicons name={icon} size={16} color={palette.textSecondary} />
      <Text style={styles.passiveText}>{text}</Text>
    </View>
  );
}

function LineItem({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <View style={styles.lineItem}>
      <Text
        style={[styles.lineLabel, muted && { color: palette.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        style={[styles.lineValue, muted && { color: palette.textSecondary }]}
      >
        ZMW {value.toFixed(2)}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: r.sm,
  },
  headerTitle: {
    ...typography.label,
    color: palette.textPrimary,
    fontSize: 16,
  },

  skeletons: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  skelSm: { height: 48, borderRadius: r.sm },
  skelMd: { height: 90, borderRadius: r.sm },
  skelLg: { height: 150, borderRadius: r.sm },

  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },

  title: {
    ...typography.heading2,
    color: palette.textPrimary,
    marginBottom: spacing.sm,
  },
  pill: {
    alignSelf: "flex-start",
    borderRadius: r.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    marginBottom: spacing.lg,
  },
  pillText: { ...typography.label, fontSize: 13 },

  // Live status banner
  banner: { borderRadius: r.md, padding: spacing.md, marginBottom: spacing.lg, gap: spacing.sm },
  bannerMain: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  bannerTitle: { ...typography.label, fontSize: 16 },
  bannerSub: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 13, marginTop: 1 },
  bannerAction: { borderRadius: r.sm, alignSelf: "flex-start" },
  bannerActionLabel: { ...typography.label, fontSize: 13 },

  // Stepper
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  stepNode: { alignItems: "center", width: 84 },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: r.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  stepCircleDone: {
    backgroundColor: palette.success,
    borderColor: palette.success,
  },
  stepCircleCurrent: {
    borderColor: palette.primary,
    backgroundColor: palette.primaryLight,
  },
  stepNum: { ...typography.label, fontSize: 13, color: palette.textDisabled },
  stepNumCurrent: { color: palette.primary },
  stepLabel: {
    ...typography.bodySmall,
    color: palette.textDisabled,
    fontSize: 12,
    marginTop: 4,
  },
  stepLabelActive: { color: palette.textPrimary },
  stepConnector: {
    flex: 1,
    height: 2,
    backgroundColor: palette.border,
    marginTop: -18,
  },
  stepConnectorDone: { backgroundColor: palette.success },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    marginVertical: spacing.lg,
  },

  sectionLabel: {
    ...typography.label,
    color: palette.textPrimary,
    marginBottom: spacing.sm,
  },

  // Customer
  customerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { ...typography.label, color: palette.primary, fontSize: 16 },
  customerInfo: { flex: 1 },
  customerName: {
    ...typography.body,
    color: palette.textPrimary,
    fontSize: 16,
    fontFamily: "DMSans_500Medium",
  },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  trustText: { ...typography.bodySmall, fontSize: 13 },
  contactRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  contactBtn: { flex: 1, borderRadius: r.sm, borderColor: palette.primary },
  contactBtnContent: { height: 44 },
  contactHint: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12, marginTop: spacing.xs },

  // Timer card wrapper (in-progress)
  timerWrap: { marginTop: spacing.md },

  // Earnings breakdown (ESCROW)
  earnRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3,
  },
  earnLabel: { ...typography.body, color: palette.textSecondary, fontSize: 14 },
  earnValue: { ...typography.body, color: palette.textPrimary, fontSize: 14 },
  earnNetRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginTop: spacing.xs, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border,
  },
  earnNetLabel: { ...typography.label, color: palette.textPrimary, fontSize: 15 },
  earnNetValue: { ...typography.label, color: palette.primary, fontSize: 18 },

  // Line items
  lineItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  lineLabel: {
    ...typography.body,
    color: palette.textPrimary,
    fontSize: 15,
    flex: 1,
    paddingRight: spacing.sm,
  },
  lineValue: { ...typography.body, color: palette.textPrimary, fontSize: 15 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  totalLabel: { ...typography.label, color: palette.textPrimary, fontSize: 15 },
  totalValue: { ...typography.label, color: palette.textPrimary, fontSize: 17 },

  // Payment block
  payBlock: {
    backgroundColor: palette.primaryLight,
    borderRadius: r.sm,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: 6,
  },
  payBlockDone: { backgroundColor: palette.successLight },
  payHeadRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  payHead: { ...typography.label, color: palette.textPrimary, fontSize: 15 },
  paySub: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  payStatusLine: {
    ...typography.bodySmall,
    color: palette.textPrimary,
    fontSize: 13,
    fontFamily: "DMSans_500Medium",
    marginTop: 2,
  },
  payBtnContent: { height: 48 },

  // Icon lines
  iconLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 3,
  },
  iconLineText: {
    ...typography.body,
    color: palette.textPrimary,
    fontSize: 15,
    flex: 1,
  },
  directionsBtn: {
    borderRadius: r.sm,
    borderColor: palette.primary,
    marginTop: spacing.md,
    alignSelf: "flex-start",
  },

  notesText: {
    ...typography.body,
    color: palette.textPrimary,
    fontSize: 15,
    lineHeight: 22,
  },

  // Customer's brief media (photos / short video)
  briefMediaRow: { gap: spacing.sm, marginTop: spacing.xs },
  briefMediaThumb: {
    width: 72,
    height: 72,
    borderRadius: r.sm,
    overflow: "hidden",
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
  },
  briefMediaImg: { width: "100%", height: "100%" },
  briefMediaPlayBadge: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
  },

  // Report
  reportRow: { borderRadius: r.sm },
  reportInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
  },
  reportText: { ...typography.body, color: palette.danger, fontSize: 15 },
  safetyForm: { gap: spacing.xs },
  chipRow: { flexDirection: "row", gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  chipActive: { backgroundColor: palette.danger, borderColor: palette.danger },
  chipText: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 13,
  },
  chipTextActive: { color: "#fff" },
  textArea: {
    ...typography.body,
    color: palette.textPrimary,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: r.sm,
    padding: spacing.sm,
    minHeight: 96,
    textAlignVertical: "top",
    marginTop: spacing.xs,
  },
  tosRow: { paddingVertical: spacing.xs },
  tosInner: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tosText: { ...typography.bodySmall, color: palette.textSecondary, flex: 1 },
  safetyBtn: { borderRadius: r.sm, marginTop: spacing.xs },

  // Action bar
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    gap: spacing.sm,
  },
  primaryBtn: { borderRadius: r.sm },
  primaryBtnContent: { height: 50 },
  secondaryBtn: { borderRadius: r.sm, borderColor: palette.primary },
  barRow: { flexDirection: "row", gap: spacing.sm },
  barRowBtn: { flex: 1, borderRadius: r.sm },
  btnLabel: { ...typography.label, fontSize: 15 },
  passive: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  passiveText: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    flex: 1,
    fontSize: 14,
  },

  // Quote sheet
  quoteOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  quoteSheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: r.md,
    borderTopRightRadius: r.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  quoteTitle: { ...typography.heading3, color: palette.textPrimary },
  quoteSub: { ...typography.bodySmall, color: palette.textSecondary },
  quoteInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: r.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  quoteCurrency: { ...typography.label, color: palette.textSecondary },
  quoteInput: {
    ...typography.heading3,
    color: palette.textPrimary,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  quoteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  quoteNoteInput: {
    ...typography.bodySmall,
    color: palette.textPrimary,
    backgroundColor: palette.background,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 60,
    textAlignVertical: "top",
    marginTop: spacing.xs,
  },
});
