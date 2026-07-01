import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Button, Menu, Text, TouchableRipple } from "react-native-paper";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  Booking,
  BookingStatus,
  TrustHint,
  bookingsApi,
} from "../../api/bookings";
import { ApiError } from "../../api/errors";
import { SafetyCategory, safetyReportsApi } from "../../api/safetyReports";
import { CardSkeleton } from "../../components/ui/SkeletonBlock";
import { useSnackbar } from "../../providers/SnackbarProvider";
import { useBookingStore } from "../../store/bookingStore";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
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
    case "FUNDS_HELD": // ESCROW equivalent of ACCEPTED — booking is confirmed/funded
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

  // Quote entry
  const [showQuote, setShowQuote] = useState(false);
  const [quotePrice, setQuotePrice] = useState("");

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
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", onPress: () => runAction(action) },
    ]);
  }

  function notYetAvailable(feature: string) {
    Alert.alert(
      feature,
      "In-app messaging is coming soon. For now, arrange contact through your usual channel."
    );
  }

  async function submitQuote() {
    const price = Number(quotePrice);
    if (!Number.isFinite(price) || price <= 0) {
      showError("Enter a valid amount above ZMW 0.");
      return;
    }
    await runAction(() => quote(booking!.id, price));
    setShowQuote(false);
    setQuotePrice("");
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
      Alert.alert(
        "Report submitted",
        "Our moderation team will review this within 1 hour."
      );
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
  const canMarkPaid =
    !CLOSED_FOR_PAYMENT.includes(booking.status) && !providerPaid;

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
        {/* Title + status */}
        <Text style={styles.title}>{booking.service.title}</Text>
        <View
          style={[styles.pill, { backgroundColor: meta.bg }]}
          accessibilityLabel={`Status: ${meta.label}`}
        >
          <Text style={[styles.pillText, { color: meta.fg }]}>
            {meta.label}
          </Text>
        </View>

        {/* Stepper */}
        <Stepper steps={steps} />

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
            icon="message-outline"
            style={styles.contactBtn}
            contentStyle={styles.contactBtnContent}
            textColor={palette.primary}
            onPress={() => notYetAvailable("Message customer")}
            accessibilityLabel="Message customer"
          >
            Message
          </Button>
          <Button
            mode="outlined"
            icon="phone-outline"
            style={styles.contactBtn}
            contentStyle={styles.contactBtnContent}
            textColor={palette.primary}
            onPress={() => notYetAvailable("Call customer")}
            accessibilityLabel="Call customer"
          >
            Call
          </Button>
        </View>

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
                name="lock-closed-outline"
                size={18}
                color={palette.primary}
              />
              <Text style={styles.payHead}>
                {["COMPLETED", "DISBURSED"].includes(booking.status)
                  ? "Funds released"
                  : "Funds held in escrow"}
              </Text>
            </View>
            <Text style={styles.paySub}>
              {["COMPLETED", "DISBURSED"].includes(booking.status)
                ? "Payment has been released to your account."
                : "The customer’s payment is held securely and released when the job is confirmed complete."}
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

        {/* 4 — Location (label only, never coordinates) */}
        <Text style={styles.sectionLabel}>Location</Text>
        <View style={styles.iconLine}>
          <Ionicons
            name="location-outline"
            size={16}
            color={palette.textSecondary}
          />
          <Text style={styles.iconLineText}>
            {booking.delivery_location_label ??
              booking.delivery_location_region ??
              "Location shared on the map"}
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
            accessibilityLabel="Get directions to the customer location"
          >
            Get directions
          </Button>
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
        onComplete={() =>
          confirmAction(
            "Mark as complete",
            "Mark this job complete? The customer is asked to confirm; it auto-confirms after the confirmation window.",
            () => deliver(booking.id)
          )
        }
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

      {/* Quote entry */}
      {showQuote && (
        <View style={styles.quoteOverlay}>
          <View style={styles.quoteSheet}>
            <Text style={styles.quoteTitle}>Send a quote</Text>
            <Text style={styles.quoteSub}>
              Propose your price. The customer pays you directly if they accept.
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
  } else if (status === "QUOTED") {
    content = (
      <PassiveNote
        icon="hourglass-outline"
        text={`Quote sent · waiting for ${buyerName} to accept${isDirect ? "" : " and pay"}.`}
      />
    );
  } else if (status === "ACCEPTED" || status === "FUNDS_HELD") {
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
    content = (
      <Button
        mode="contained"
        style={styles.primaryBtn}
        contentStyle={styles.primaryBtnContent}
        labelStyle={styles.btnLabel}
        loading={busy}
        disabled={busy}
        onPress={onComplete}
      >
        Mark as complete
      </Button>
    );
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
});
