/**
 * Customer — Bookings screen  (v3.1 §3 tab 2)
 *
 * Layout:  "Bookings" title  +  Active / Past segmented control
 *
 * DIRECT mode (default):
 *   Active: REQUESTED (awaiting provider) → QUOTED → ACCEPTED → IN_PROGRESS → DELIVERED
 *   Past:   COMPLETED / CANCELLED / DECLINED / EXPIRED / NO_SHOW / DISPUTED
 *
 * ESCROW mode (dormant):
 *   Active: PENDING_PAYMENT → AWAITING_KYC → FUNDS_HELD → IN_PROGRESS → DELIVERED
 *   Past:   COMPLETED / DISBURSED / CANCELLED / DISPUTED / CHARGEBACK_PENDING
 *
 * All copy driven by booking.payment_mode — one source of truth.
 */

import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Linking,
  Modal,
  RefreshControl,
  StyleSheet,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Booking, BookingStatus } from '../../api/bookings';
import { SafetyCategory, safetyReportsApi } from '../../api/safetyReports';
import { VettingBadge } from '../../components/discovery/VettingBadge';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useBookingStore } from '../../store/bookingStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

// ─────────────────────────────────────────────────────────────────────────────
// Status configuration
// ─────────────────────────────────────────────────────────────────────────────

type Segment = 'active' | 'past';

const ACTIVE_STATUSES = new Set<BookingStatus>([
  // DIRECT active
  'REQUESTED', 'QUOTED', 'ACCEPTED',
  // Shared active
  'IN_PROGRESS', 'DELIVERED',
  // ESCROW active
  'PENDING_PAYMENT', 'AWAITING_KYC', 'FUNDS_HELD',
]);

const ACTIVE_SORT_ORDER: Record<BookingStatus, number> = {
  // Highest priority first
  DELIVERED:          0,
  IN_PROGRESS:        1,
  QUOTED:             2,   // buyer action needed (accept/decline quote)
  REQUESTED:          3,
  ACCEPTED:           4,
  PENDING_PAYMENT:    5,
  AWAITING_KYC:       5,
  FUNDS_HELD:         5,
  // Past (not shown in active, but needed for type completeness)
  COMPLETED:          9,
  DISBURSED:          9,
  CANCELLED:          9,
  DISPUTED:           9,
  CHARGEBACK_PENDING: 9,
  DECLINED:           9,
  EXPIRED:            9,
  NO_SHOW:            9,
};

interface StatusConfig {
  label: string;
  color: string;
  bg:    string;
  live?: boolean;
}

const STATUS_CONFIG: Record<BookingStatus, StatusConfig> = {
  // DIRECT
  REQUESTED:          { label: 'Awaiting response',  color: palette.textSecondary, bg: '#F3F4F6'             },
  QUOTED:             { label: 'Quote received',      color: palette.warning,       bg: palette.warningLight  },
  ACCEPTED:           { label: 'Upcoming',            color: palette.primary,       bg: palette.primaryLight  },
  DECLINED:           { label: 'Declined',            color: palette.textSecondary, bg: '#F3F4F6'             },
  EXPIRED:            { label: 'Expired',             color: palette.textSecondary, bg: '#F3F4F6'             },
  NO_SHOW:            { label: 'No-show',             color: palette.danger,        bg: palette.dangerLight   },
  // Shared
  IN_PROGRESS:        { label: 'In progress',         color: palette.success,       bg: palette.successLight, live: true },
  DELIVERED:          { label: 'Confirm completion',  color: palette.warning,       bg: palette.warningLight  },
  COMPLETED:          { label: 'Completed',           color: palette.textSecondary, bg: '#F3F4F6'             },
  DISPUTED:           { label: 'Disputed',            color: palette.danger,        bg: palette.dangerLight   },
  CANCELLED:          { label: 'Cancelled',           color: palette.textSecondary, bg: '#F3F4F6'             },
  // ESCROW
  PENDING_PAYMENT:    { label: 'Payment pending',     color: palette.textSecondary, bg: '#F3F4F6'             },
  AWAITING_KYC:       { label: 'Awaiting verification', color: palette.warning,     bg: palette.warningLight  },
  FUNDS_HELD:         { label: 'Upcoming',            color: palette.primary,       bg: palette.primaryLight  },
  DISBURSED:          { label: 'Completed',           color: palette.textSecondary, bg: '#F3F4F6'             },
  CHARGEBACK_PENDING: { label: 'Chargeback review',   color: palette.danger,        bg: palette.dangerLight   },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtAmount(n: number) {
  return `ZMW ${n.toFixed(2)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZM', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-ZM', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** Mode-aware status info line — one source of truth per payment_mode. */
function statusInfoLine(b: Booking): string {
  const displayAmt = b.agreed_amount ?? b.amount ?? b.service.base_price;
  const amt  = fmtAmount(displayAmt);
  const prov = b.provider.display_name ?? 'provider';

  if (b.payment_mode === 'DIRECT') {
    switch (b.status) {
      case 'REQUESTED':   return `${amt} — awaiting provider response`;
      case 'QUOTED':      return `Provider quoted ${fmtAmount(b.agreed_amount!)} — review below`;
      case 'ACCEPTED':    return `${amt} agreed — pay ${prov} directly`;
      case 'IN_PROGRESS': return `${amt} — pay ${prov} directly on completion`;
      case 'DELIVERED':   return `${amt} — confirm to close this booking`;
      case 'COMPLETED':   return `${amt} paid to ${prov}`;
      case 'DECLINED':    return 'Provider declined this request';
      case 'EXPIRED':     return 'No response received — request expired';
      case 'NO_SHOW':     return 'Provider did not show up';
      case 'CANCELLED':   return 'Booking cancelled';
      case 'DISPUTED':    return `${amt} — dispute in progress`;
      default:            return amt;
    }
  }

  // ESCROW
  switch (b.status) {
    case 'PENDING_PAYMENT':    return `${amt} awaiting your payment`;
    case 'AWAITING_KYC':       return `${amt} held — awaiting provider verification`;
    case 'FUNDS_HELD':         return `${amt} held in escrow`;
    case 'IN_PROGRESS':        return `${amt} held in escrow until completed`;
    case 'DELIVERED':          return `${amt} held — release to pay ${prov}`;
    case 'COMPLETED':          return `${amt} released to ${prov}`;
    case 'DISBURSED':          return `${amt} paid to ${prov}`;
    case 'CANCELLED':          return b.amount && b.amount > 0 ? `${amt} refunded` : 'No charge';
    case 'DISPUTED':           return `${amt} held — dispute in progress`;
    case 'CHARGEBACK_PENDING': return `${amt} frozen — chargeback review`;
    default:                   return amt;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LiveDot — subtle pulsing indicator for IN_PROGRESS
// ─────────────────────────────────────────────────────────────────────────────

function LiveDot() {
  const pulse        = useRef(new Animated.Value(1)).current;
  const [noMotion, setNoMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setNoMotion);
  }, []);

  useEffect(() => {
    if (noMotion) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.2, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,   duration: 900, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [noMotion, pulse]);

  return (
    <Animated.View
      style={[styles.liveDot, { opacity: noMotion ? 1 : pulse }]}
      accessibilityLabel="Booking in progress"
    />
  );
}

function StatusPill({ status }: { status: BookingStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <View style={[styles.pill, { backgroundColor: cfg.bg }]}>
      {cfg.live && <LiveDot />}
      <Text style={[styles.pillText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CountdownText — DELIVERED auto-confirm timer
// ─────────────────────────────────────────────────────────────────────────────

function useCountdown(isoDate: string | null | undefined): string {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!isoDate) return;
    const tick = () => {
      const ms = new Date(isoDate).getTime() - Date.now();
      if (ms <= 0) { setText(''); return; }
      const d = Math.floor(ms / 86_400_000);
      const h = Math.floor((ms % 86_400_000) / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setText(d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [isoDate]);
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// EmergencySheet — IN_PROGRESS only (v3 §11.4)
// ─────────────────────────────────────────────────────────────────────────────

function EmergencySheet({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [alerting, setAlerting] = useState(false);

  const handleCall = () => Linking.openURL('tel:991');

  const handleAlertPlatform = async () => {
    setAlerting(true);
    try {
      await safetyReportsApi.file({
        reported_id:      booking.provider.id,
        booking_id:       booking.id,
        category:         'VIOLENCE_THREAT',
        description:      'Emergency safety alert triggered during an in-progress booking.',
        tos_acknowledged: true,
      });
      Alert.alert(
        'Safety team alerted',
        'Our on-call safety team has been notified and will contact you within minutes. If in immediate danger, call 991.',
        [{ text: 'OK', onPress: onClose }],
      );
    } catch {
      Alert.alert(
        'Could not reach safety team',
        'Unable to connect. Please call 991 directly for immediate help.',
        [{ text: 'OK' }],
      );
    } finally {
      setAlerting(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.overlayBackdrop}>
        <View style={styles.emergencySheet} accessible accessibilityLabel="Emergency help">
          <View style={styles.emergencyHeader}>
            <Ionicons name="alert-circle" size={28} color={palette.danger} />
            <Text style={styles.emergencyTitle}>Emergency help</Text>
          </View>
          <Text style={styles.emergencyBody}>
            Use these options if you are in immediate danger or feel unsafe during this booking.
          </Text>
          <Text style={styles.emergencySubBody}>
            Alerting the platform shares your booking status and the provider's verified identity
            with our on-call safety team. A follow-up outreach happens within 2 hours.
          </Text>
          <TouchableRipple
            style={styles.callBtn}
            onPress={handleCall}
            rippleColor="rgba(255,255,255,0.25)"
            accessibilityLabel="Call 991, Zambia emergency services"
            accessibilityRole="button"
          >
            <View style={styles.btnInner}>
              <Ionicons name="call" size={18} color="#FFFFFF" />
              <Text style={styles.callBtnText}>Call 991 — emergency services</Text>
            </View>
          </TouchableRipple>
          <TouchableRipple
            style={styles.alertBtn}
            onPress={handleAlertPlatform}
            disabled={alerting}
            rippleColor={`${palette.danger}20`}
            accessibilityLabel="Alert platform safety team"
            accessibilityRole="button"
          >
            <View style={styles.btnInner}>
              {alerting
                ? <ActivityIndicator size={16} color={palette.danger} />
                : <Ionicons name="shield-outline" size={18} color={palette.danger} />
              }
              <Text style={styles.alertBtnText}>Alert platform safety team</Text>
            </View>
          </TouchableRipple>
          <TouchableOpacity
            style={styles.dismissBtn}
            onPress={onClose}
            accessibilityLabel="I am safe, dismiss"
            accessibilityRole="button"
          >
            <Text style={styles.dismissText}>I'm safe — dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReportSheet — available from every booking (v3 §11.3)
// ─────────────────────────────────────────────────────────────────────────────

const REPORT_CATEGORIES: { value: SafetyCategory; label: string }[] = [
  { value: 'HARASSMENT',      label: 'Harassment'         },
  { value: 'VIOLENCE_THREAT', label: 'Violence or threat' },
  { value: 'UNSAFE_BEHAVIOR', label: 'Unsafe behaviour'   },
  { value: 'DISCRIMINATION',  label: 'Discrimination'     },
  { value: 'STOLEN_PROPERTY', label: 'Stolen property'    },
  { value: 'OTHER',           label: 'Other'              },
];

function ReportSheet({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [category,    setCategory]    = useState<SafetyCategory>('OTHER');
  const [description, setDescription] = useState('');
  const [submitting,  setSubmitting]  = useState(false);

  const handleSubmit = async () => {
    if (!description.trim()) {
      Alert.alert('Description required', 'Please describe the issue briefly.');
      return;
    }
    setSubmitting(true);
    try {
      await safetyReportsApi.file({
        reported_id:      booking.provider.id,
        booking_id:       booking.id,
        category,
        description:      description.trim(),
        tos_acknowledged: true,
      });
      Alert.alert(
        'Report submitted',
        'Our team will review this promptly. A single credible report may result in the provider being restricted while we investigate.',
        [{ text: 'OK', onPress: onClose }],
      );
    } catch {
      Alert.alert('Submission failed', 'Could not submit the report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.overlayBackdrop}>
        <View style={styles.reportSheet} accessible accessibilityLabel="Report an issue">
          <View style={styles.reportHeader}>
            <Text style={styles.reportTitle}>Report an issue</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={20} color={palette.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.reportLabel}>What happened?</Text>
          <View
            style={styles.reportCategories}
            accessibilityRole="radiogroup"
            accessibilityLabel="Report category"
          >
            {REPORT_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.value}
                style={[styles.catOption, category === cat.value && styles.catSelected]}
                onPress={() => setCategory(cat.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: category === cat.value }}
                accessibilityLabel={cat.label}
              >
                <Text style={[styles.catText, category === cat.value && styles.catTextSelected]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.reportLabel}>Describe the issue</Text>
          <RNTextInput
            style={styles.reportInput}
            value={description}
            onChangeText={setDescription}
            placeholder="Briefly describe what happened…"
            placeholderTextColor={palette.textDisabled}
            multiline
            numberOfLines={4}
            maxLength={500}
            textAlignVertical="top"
            accessibilityLabel="Describe the issue"
          />
          <Text style={styles.tosNote}>
            Filing a false report violates our terms of service and may result in account restriction.
          </Text>
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting}
            style={styles.submitBtn}
            contentStyle={{ paddingVertical: 4 }}
            accessibilityLabel="Submit report"
          >
            Submit report
          </Button>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BookingCard
// ─────────────────────────────────────────────────────────────────────────────

interface CardProps {
  booking:        Booking;
  navigation:     any;
  onComplete:     (id: string) => void;
  onCancel:       (id: string) => void;
  onPay:          (id: string) => void;
  onAcceptQuote:  (id: string) => void;
  onEmergency:    (b: Booking) => void;
  onReport:       (b: Booking) => void;
  submitting:     boolean;
}

function BookingCard({
  booking, navigation, onComplete, onCancel, onPay, onAcceptQuote, onEmergency, onReport, submitting,
}: CardProps) {
  const { status, payment_mode: mode } = booking;
  const cfg      = STATUS_CONFIG[status];
  const provName = booking.provider.display_name ?? booking.provider.email;
  const tier     = booking.provider.trust_tier;
  const locLabel = booking.delivery_location_label;
  const hasReview = booking.has_review ?? false;
  const catIcon  = (booking.service.category_icon ?? 'briefcase-outline') as any;
  const remaining = useCountdown(status === 'DELIVERED' ? booking.auto_release_at : null);
  const isDirect  = mode === 'DIRECT';

  const confirmComplete = () =>
    Alert.alert(
      'Confirm completion',
      isDirect
        ? `Confirm that ${provName} completed the work. This closes the booking.`
        : `This will release payment to ${provName}. You won't be able to dispute after confirming.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: isDirect ? 'Confirm done' : 'Confirm & release', onPress: () => onComplete(booking.id) },
      ],
    );

  const confirmCancel = () =>
    Alert.alert(
      'Cancel booking',
      'Are you sure? Cancellation may affect your account rating.',
      [
        { text: 'Keep booking',   style: 'cancel'      },
        { text: 'Cancel booking', style: 'destructive', onPress: () => onCancel(booking.id) },
      ],
    );

  const confirmAcceptQuote = () => {
    const quoted = booking.agreed_amount;
    Alert.alert(
      'Accept this quote?',
      `The provider has quoted ${quoted != null ? fmtAmount(quoted) : '—'} for this booking. Accept?`,
      [
        { text: 'Not now',      style: 'cancel' },
        { text: 'Accept quote', onPress: () => onAcceptQuote(booking.id) },
      ],
    );
  };

  return (
    <TouchableRipple
      style={styles.card}
      onPress={() => navigation.navigate('BookingDetail', { bookingId: booking.id })}
      rippleColor={`${palette.primary}10`}
      accessibilityRole="button"
      accessibilityLabel={`${booking.service.title}, ${cfg.label}`}
    >
      <View>
        {/* ── Top: thumb + service info + status pill ── */}
        <View style={styles.cardTop}>
          <View style={styles.thumb}>
            <Ionicons name={catIcon} size={20} color={palette.primary} />
          </View>
          <View style={{ flex: 1, marginRight: spacing.xs }}>
            <Text style={styles.serviceTitle} numberOfLines={2}>{booking.service.title}</Text>
            <View style={styles.provRow}>
              <Text style={styles.provName} numberOfLines={1}>{provName}</Text>
              {tier != null && tier >= 3 && (
                <Ionicons
                  name="checkmark-circle"
                  size={14}
                  color={palette.success}
                  accessibilityLabel="Verified provider"
                />
              )}
              {tier != null && <VettingBadge trustTier={tier} size="sm" />}
            </View>
          </View>
          <StatusPill status={status} />
        </View>

        <View style={styles.sep} />

        {/* ── Meta: date/time + delivery location ── */}
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={13} color={palette.textSecondary} />
          <Text style={styles.metaTxt}>
            {fmtDate(booking.scheduled_start)} · {fmtTime(booking.scheduled_start)}
          </Text>
        </View>
        {!!locLabel && (
          <View style={[styles.metaRow, { marginTop: 4 }]}>
            <Ionicons name="location-outline" size={13} color={palette.textSecondary} />
            <Text style={styles.metaTxt} numberOfLines={1}>{locLabel}</Text>
          </View>
        )}

        <View style={styles.sep} />

        {/* ── Status info line (mode-aware) ── */}
        <View style={styles.escrowRow}>
          <Ionicons
            name={isDirect ? 'cash-outline' : 'lock-closed-outline'}
            size={13}
            color={palette.textSecondary}
          />
          <Text style={styles.escrowTxt}>{statusInfoLine(booking)}</Text>
        </View>

        {/* DELIVERED: auto-confirm countdown */}
        {status === 'DELIVERED' && !!remaining && (
          <Text style={styles.countdownTxt}>Auto-confirms in {remaining}</Text>
        )}

        {/* DISPUTED: dispute state */}
        {status === 'DISPUTED' && booking.dispute && (
          <Text style={styles.stateTxt}>
            Dispute: {booking.dispute.status.replace(/_/g, ' ').toLowerCase()}
          </Text>
        )}

        {/* ── Action row — per status ── */}
        <View style={styles.actions}>

          {/* ── DELIVERED ── */}
          {status === 'DELIVERED' && (
            <>
              <TouchableOpacity
                style={styles.actionSecondary}
                onPress={() => onReport(booking)}
                accessibilityLabel="Report an issue"
                accessibilityRole="button"
              >
                <Text style={styles.actionSecondaryText}>Report issue</Text>
              </TouchableOpacity>
              <TouchableRipple
                style={[styles.actionPrimary, submitting && styles.actionDisabled]}
                onPress={confirmComplete}
                disabled={submitting}
                rippleColor="rgba(255,255,255,0.2)"
                accessibilityLabel={isDirect ? 'Confirm job done' : 'Confirm and release payment'}
                accessibilityRole="button"
              >
                <View style={styles.actionPrimaryInner}>
                  {submitting
                    ? <ActivityIndicator size={14} color="#FFFFFF" />
                    : <Text style={styles.actionPrimaryText}>
                        {isDirect ? 'Confirm done' : 'Confirm & release'}
                      </Text>
                  }
                </View>
              </TouchableRipple>
            </>
          )}

          {/* ── IN_PROGRESS ── */}
          {status === 'IN_PROGRESS' && (
            <>
              <TouchableRipple
                style={styles.actionEmergency}
                onPress={() => onEmergency(booking)}
                rippleColor={`${palette.danger}20`}
                accessibilityLabel="Emergency help"
                accessibilityRole="button"
              >
                <View style={styles.btnInnerSmall}>
                  <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
                  <Text style={styles.actionEmergencyText}>Emergency</Text>
                </View>
              </TouchableRipple>
              <TouchableOpacity
                style={styles.actionGhost}
                onPress={() => navigation.navigate('BookingDetail', { bookingId: booking.id })}
                accessibilityLabel="Track booking"
                accessibilityRole="button"
              >
                <Text style={styles.actionGhostText}>Track</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── ACCEPTED (both modes share this via FUNDS_HELD / ACCEPTED) ── */}
          {(status === 'ACCEPTED' || status === 'FUNDS_HELD') && (
            <>
              <TouchableOpacity
                style={styles.actionDestructive}
                onPress={confirmCancel}
                accessibilityLabel="Cancel booking"
                accessibilityRole="button"
              >
                <Text style={styles.actionDestructiveText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── QUOTED — buyer must accept or decline the provider's quote ── */}
          {status === 'QUOTED' && (
            <>
              <TouchableOpacity
                style={styles.actionDestructive}
                onPress={confirmCancel}
                accessibilityLabel="Decline quote"
                accessibilityRole="button"
              >
                <Text style={styles.actionDestructiveText}>Decline</Text>
              </TouchableOpacity>
              <TouchableRipple
                style={[styles.actionPrimary, submitting && styles.actionDisabled]}
                onPress={confirmAcceptQuote}
                disabled={submitting}
                rippleColor="rgba(255,255,255,0.2)"
                accessibilityLabel="Accept quote"
                accessibilityRole="button"
              >
                <View style={styles.actionPrimaryInner}>
                  {submitting
                    ? <ActivityIndicator size={14} color="#FFFFFF" />
                    : <Text style={styles.actionPrimaryText}>Accept quote</Text>
                  }
                </View>
              </TouchableRipple>
            </>
          )}

          {/* ── REQUESTED — awaiting provider; buyer can cancel ── */}
          {status === 'REQUESTED' && (
            <TouchableOpacity
              style={styles.actionDestructive}
              onPress={confirmCancel}
              accessibilityLabel="Cancel request"
              accessibilityRole="button"
            >
              <Text style={styles.actionDestructiveText}>Cancel request</Text>
            </TouchableOpacity>
          )}

          {/* ── PENDING_PAYMENT (ESCROW) ── */}
          {status === 'PENDING_PAYMENT' && (
            <TouchableRipple
              style={[styles.actionPrimary, { flex: 1 }, submitting && styles.actionDisabled]}
              onPress={() => onPay(booking.id)}
              disabled={submitting}
              rippleColor="rgba(255,255,255,0.2)"
              accessibilityLabel="Pay now"
              accessibilityRole="button"
            >
              <View style={styles.actionPrimaryInner}>
                {submitting
                  ? <ActivityIndicator size={14} color="#FFFFFF" />
                  : <Text style={styles.actionPrimaryText}>Pay now</Text>
                }
              </View>
            </TouchableRipple>
          )}

          {/* ── COMPLETED / DISBURSED ── */}
          {(status === 'COMPLETED' || status === 'DISBURSED') && (
            <>
              <TouchableOpacity
                style={styles.actionGhost}
                onPress={() => navigation.navigate('ServiceDetail', { serviceId: booking.service.id })}
                accessibilityLabel="Book this service again"
                accessibilityRole="button"
              >
                <Text style={styles.actionGhostText}>Book again</Text>
              </TouchableOpacity>
              {!hasReview && (
                <TouchableRipple
                  style={styles.actionPrimary}
                  onPress={() => navigation.navigate('BookingDetail', { bookingId: booking.id, review: true })}
                  rippleColor="rgba(255,255,255,0.2)"
                  accessibilityLabel="Leave a review"
                  accessibilityRole="button"
                >
                  <View style={styles.actionPrimaryInner}>
                    <Text style={styles.actionPrimaryText}>Leave review</Text>
                  </View>
                </TouchableRipple>
              )}
            </>
          )}
        </View>

        {/* Report is available from all cards (v3 §11.3) */}
        {status !== 'DELIVERED' && (
          <TouchableOpacity
            style={styles.reportLink}
            onPress={() => onReport(booking)}
            accessibilityLabel="Report an issue with this booking"
            accessibilityRole="button"
          >
            <Ionicons name="flag-outline" size={12} color={palette.textDisabled} />
            <Text style={styles.reportLinkText}>Report issue</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableRipple>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BookingsScreen
// ─────────────────────────────────────────────────────────────────────────────

export default function BookingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { showError } = useSnackbar();
  const {
    bookings, loading, error, page, lastPage,
    fetchBookings, loadMore, complete, cancel, pay, acceptQuote, clearError, submitting,
  } = useBookingStore();

  const [segment,          setSegment]         = useState<Segment>('active');
  const [refreshing,       setRefreshing]       = useState(false);
  const [emergencyBooking, setEmergencyBooking] = useState<Booking | null>(null);
  const [reportBooking,    setReportBooking]    = useState<Booking | null>(null);

  useFocusEffect(
    useCallback(() => { fetchBookings(true); }, [fetchBookings]),
  );

  useEffect(() => {
    if (error) { showError(error.message); clearError(); }
  }, [error, showError, clearError]);

  const activeBookings = useMemo(() =>
    bookings
      .filter((b) => ACTIVE_STATUSES.has(b.status))
      .sort((a, b) => {
        const diff = ACTIVE_SORT_ORDER[a.status] - ACTIVE_SORT_ORDER[b.status];
        if (diff !== 0) return diff;
        return new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
      }),
  [bookings]);

  const pastBookings = useMemo(() =>
    bookings
      .filter((b) => !ACTIVE_STATUSES.has(b.status))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
  [bookings]);

  const displayData = segment === 'active' ? activeBookings : pastBookings;
  const activeCount = activeBookings.length;

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBookings(true);
    setRefreshing(false);
  };

  const handleComplete = useCallback(async (id: string) => {
    try {
      await complete(id);
    } catch {
      showError('Could not confirm completion. Please try again.');
    }
  }, [complete, showError]);

  const handleCancel = useCallback(async (id: string) => {
    try {
      await cancel(id);
    } catch {
      showError('Could not cancel the booking. Please try again.');
    }
  }, [cancel, showError]);

  const handlePay = useCallback(async (id: string) => {
    try {
      await pay(id);
    } catch (e: any) {
      showError(e?.message ?? 'Payment failed. Please try again.');
    }
  }, [pay, showError]);

  const handleAcceptQuote = useCallback(async (id: string) => {
    try {
      await acceptQuote(id);
    } catch (e: any) {
      showError(e?.message ?? 'Could not accept quote. Please try again.');
    }
  }, [acceptQuote, showError]);

  const renderItem = useCallback(({ item }: { item: Booking }) => (
    <BookingCard
      booking={item}
      navigation={navigation}
      onComplete={handleComplete}
      onCancel={handleCancel}
      onPay={handlePay}
      onAcceptQuote={handleAcceptQuote}
      onEmergency={setEmergencyBooking}
      onReport={setReportBooking}
      submitting={submitting}
    />
  ), [navigation, handleComplete, handleCancel, handlePay, handleAcceptQuote, submitting]);

  const isFirstLoad = loading && bookings.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.title}>Bookings</Text>
      </View>

      {/* ── Segmented control ── */}
      <View
        style={styles.segmentRow}
        accessibilityRole="tablist"
        accessibilityLabel="Booking segments"
      >
        <TouchableOpacity
          style={[styles.tab, segment === 'active' && styles.tabActive]}
          onPress={() => setSegment('active')}
          accessibilityRole="tab"
          accessibilityState={{ selected: segment === 'active' }}
          accessibilityLabel={`Active bookings${activeCount > 0 ? `, ${activeCount} items` : ''}`}
        >
          <Text style={[styles.tabText, segment === 'active' && styles.tabTextActive]}>
            Active
          </Text>
          {activeCount > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{activeCount}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, segment === 'past' && styles.tabActive]}
          onPress={() => setSegment('past')}
          accessibilityRole="tab"
          accessibilityState={{ selected: segment === 'past' }}
          accessibilityLabel="Past bookings"
        >
          <Text style={[styles.tabText, segment === 'past' && styles.tabTextActive]}>
            Past
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Content ── */}
      {isFirstLoad ? (
        <View style={styles.skeletons}>
          {[1, 2, 3].map((k) => <CardSkeleton key={k} style={styles.skeleton} />)}
        </View>
      ) : displayData.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name={segment === 'active' ? 'calendar-outline' : 'time-outline'}
                size={40}
                color={palette.primary}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {segment === 'active' ? 'No active bookings' : 'No past bookings yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {segment === 'active'
                ? 'Find a trusted provider and book a service to get started.'
                : 'Completed and cancelled bookings will appear here.'}
            </Text>
            {segment === 'active' && (
              <Button
                mode="contained"
                onPress={() => navigation.navigate('Home')}
                style={styles.emptyBtn}
                contentStyle={{ paddingHorizontal: spacing.md, paddingVertical: 2 }}
                accessibilityLabel="Browse services"
              >
                Browse services
              </Button>
            )}
          </View>
        </View>
      ) : (
        <FlashList
          data={displayData}
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          // @ts-ignore
          estimatedItemSize={220}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: insets.bottom + 100,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={palette.primary}
              colors={[palette.primary]}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loading && page < lastPage
              ? <ActivityIndicator style={{ marginVertical: spacing.md }} color={palette.primary} />
              : null
          }
        />
      )}

      {/* ── Sheets ── */}
      {emergencyBooking && emergencyBooking.status === 'IN_PROGRESS' && (
        <EmergencySheet
          booking={emergencyBooking}
          onClose={() => setEmergencyBooking(null)}
        />
      )}
      {reportBooking && (
        <ReportSheet
          booking={reportBooking}
          onClose={() => setReportBooking(null)}
        />
      )}
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop:        spacing.md,
    paddingBottom:     spacing.sm,
  },
  title: { ...typography.heading2, color: palette.textPrimary },

  segmentRow: {
    flexDirection:     'row',
    marginHorizontal:  spacing.lg,
    marginBottom:      spacing.md,
    backgroundColor:   palette.surface,
    borderRadius:      r.lg,
    borderWidth:       1,
    borderColor:       palette.border,
    padding:           3,
  },
  tab: {
    flex:            1,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    paddingVertical: spacing.sm,
    borderRadius:    r.md,
    gap:             6,
    minHeight:       44,
  },
  tabActive:     { backgroundColor: palette.primary },
  tabText:       { ...typography.label, color: palette.textSecondary, fontSize: 14 },
  tabTextActive: { color: '#FFFFFF' },
  countBadge: {
    backgroundColor: '#FFFFFF',
    borderRadius:    r.full,
    minWidth:        20,
    height:          20,
    paddingHorizontal: 5,
    alignItems:      'center',
    justifyContent:  'center',
  },
  countBadgeText: { ...typography.label, color: palette.primary, fontSize: 11 },

  skeletons: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  skeleton:  { borderRadius: r.lg },

  card: {
    backgroundColor: palette.surface,
    borderRadius:    r.lg,
    borderWidth:     1,
    borderColor:     palette.border,
    padding:         spacing.md,
    marginBottom:    spacing.sm,
    ...shadow.card,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           spacing.sm,
    marginBottom:  spacing.sm,
  },
  thumb: {
    width:           44,
    height:          44,
    borderRadius:    r.md,
    backgroundColor: palette.primaryLight,
    alignItems:      'center',
    justifyContent:  'center',
  },
  serviceTitle: { ...typography.label, color: palette.textPrimary, fontSize: 15 },
  provRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' },
  provName:     { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },

  sep: { height: 1, backgroundColor: palette.border, marginVertical: spacing.sm },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaTxt: { ...typography.bodySmall, color: palette.textSecondary, flex: 1, fontSize: 13 },

  escrowRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  escrowTxt: { ...typography.bodySmall, color: palette.textSecondary, flex: 1, fontSize: 12 },

  countdownTxt: {
    ...typography.bodySmall,
    color:      palette.warning,
    fontSize:   11,
    marginTop:  3,
    marginLeft: 18,
  },
  stateTxt: {
    ...typography.bodySmall,
    color:         palette.textSecondary,
    fontSize:      11,
    marginTop:     3,
    marginLeft:    18,
    textTransform: 'capitalize',
  },

  pill: {
    flexDirection:   'row',
    alignItems:      'center',
    borderRadius:    r.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap:             4,
    flexShrink:      0,
  },
  pillText: { ...typography.label, fontSize: 11 },
  liveDot:  { width: 7, height: 7, borderRadius: r.full, backgroundColor: palette.success },

  actions: {
    flexDirection:  'row',
    alignItems:     'center',
    flexWrap:       'wrap',
    gap:            spacing.sm,
    marginTop:      spacing.md,
  },
  actionPrimary: {
    backgroundColor: palette.primary,
    borderRadius:    r.md,
    overflow:        'hidden',
    minWidth:        44,
  },
  actionPrimaryInner: {
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    alignItems:        'center',
    justifyContent:    'center',
    flexDirection:     'row',
    gap:               6,
  },
  actionPrimaryText: { ...typography.label, color: '#FFFFFF', fontSize: 13 },
  actionDisabled:    { opacity: 0.55 },

  actionSecondary: {
    borderWidth:     1,
    borderColor:     palette.border,
    borderRadius:    r.md,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    minHeight:       44,
    justifyContent:  'center',
  },
  actionSecondaryText: { ...typography.label, color: palette.textSecondary, fontSize: 13 },

  actionGhost: {
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    minHeight:         44,
    justifyContent:    'center',
  },
  actionGhostText: { ...typography.label, color: palette.primary, fontSize: 13 },

  actionDestructive: {
    borderWidth:     1,
    borderColor:     palette.dangerLight,
    borderRadius:    r.md,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    minHeight:       44,
    justifyContent:  'center',
  },
  actionDestructiveText: { ...typography.label, color: palette.danger, fontSize: 13 },

  actionEmergency: {
    borderWidth:     1,
    borderColor:     palette.dangerLight,
    borderRadius:    r.md,
    overflow:        'hidden',
    minHeight:       44,
    justifyContent:  'center',
  },
  btnInnerSmall: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             5,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
  },
  actionEmergencyText: { ...typography.label, color: palette.danger, fontSize: 13 },

  reportLink: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             4,
    marginTop:       spacing.xs,
    paddingVertical: 4,
    alignSelf:       'flex-end',
  },
  reportLinkText: { ...typography.bodySmall, color: palette.textDisabled, fontSize: 11 },

  emptyWrap: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  emptyCard: {
    borderRadius:    r.xl,
    borderWidth:     1,
    borderColor:     palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    alignItems:      'center',
    ...shadow.card,
  },
  emptyIcon: {
    width:           80,
    height:          80,
    borderRadius:    r.full,
    backgroundColor: palette.primaryLight,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    spacing.md,
  },
  emptyTitle: { ...typography.heading3, color: palette.textPrimary, marginBottom: spacing.xs, textAlign: 'center' },
  emptyBody:  { ...typography.body, color: palette.textSecondary, textAlign: 'center', maxWidth: 280, marginBottom: spacing.lg },
  emptyBtn:   { borderRadius: r.lg },

  overlayBackdrop: {
    flex:              1,
    backgroundColor:   'rgba(15,23,42,0.6)',
    justifyContent:    'center',
    paddingHorizontal: spacing.lg,
  },
  emergencySheet: {
    backgroundColor: palette.surface,
    borderRadius:    r.xl,
    padding:         spacing.lg,
    ...shadow.modal,
  },
  emergencyHeader: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing.sm,
    marginBottom:  spacing.md,
  },
  emergencyTitle:   { ...typography.heading3, color: palette.textPrimary },
  emergencyBody:    { ...typography.body, color: palette.textPrimary, marginBottom: spacing.sm },
  emergencySubBody: { ...typography.bodySmall, color: palette.textSecondary, marginBottom: spacing.lg },

  callBtn: {
    backgroundColor: palette.danger,
    borderRadius:    r.lg,
    overflow:        'hidden',
    marginBottom:    spacing.sm,
  },
  btnInner: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    justifyContent:  'center',
  },
  callBtnText: { ...typography.label, color: '#FFFFFF', fontSize: 15 },

  alertBtn: {
    borderWidth:   1,
    borderColor:   palette.dangerLight,
    borderRadius:  r.lg,
    overflow:      'hidden',
    marginBottom:  spacing.md,
  },
  alertBtnText: { ...typography.label, color: palette.danger, fontSize: 15 },

  dismissBtn: {
    alignItems:      'center',
    paddingVertical: spacing.sm,
    minHeight:       44,
    justifyContent:  'center',
  },
  dismissText: { ...typography.label, color: palette.textSecondary, fontSize: 14 },

  reportSheet: {
    backgroundColor:      palette.surface,
    borderTopLeftRadius:  r.xl,
    borderTopRightRadius: r.xl,
    padding:              spacing.lg,
    paddingBottom:        spacing.xl,
    position:             'absolute',
    bottom:               0,
    left:                 0,
    right:                0,
    ...shadow.modal,
  },
  reportHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   spacing.md,
  },
  reportTitle: { ...typography.heading3, color: palette.textPrimary },
  reportLabel: { ...typography.label, color: palette.textSecondary, marginBottom: spacing.xs, fontSize: 13 },
  reportCategories: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           spacing.xs,
    marginBottom:  spacing.md,
  },
  catOption: {
    borderWidth:     1,
    borderColor:     palette.border,
    borderRadius:    r.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight:       36,
    justifyContent:  'center',
  },
  catSelected:     { borderColor: palette.primary, backgroundColor: palette.primaryLight },
  catText:         { ...typography.bodySmall, color: palette.textSecondary, fontSize: 13 },
  catTextSelected: { color: palette.primary },
  reportInput: {
    borderWidth:  1,
    borderColor:  palette.border,
    borderRadius: r.md,
    padding:      spacing.md,
    color:        palette.textPrimary,
    fontSize:     14,
    minHeight:    100,
    marginBottom: spacing.sm,
    fontFamily:   'PlusJakartaSans_400Regular',
  },
  tosNote: {
    ...typography.bodySmall,
    color:        palette.textDisabled,
    fontSize:     11,
    marginBottom: spacing.md,
  },
  submitBtn: { borderRadius: r.lg },
});
