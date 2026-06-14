import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button, Dialog, Portal, Text, TextInput as PaperTextInput, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../api/errors';
import { Booking, BookingStatus, bookingsApi } from '../../api/bookings';
import { SafetyCategory, safetyReportsApi } from '../../api/safetyReports';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useBookingStore } from '../../store/bookingStore';
import { useAuthStore } from '../../store/authStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

async function reverseGeocodeName(lat: number, lon: number): Promise<string> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse` +
      `?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SebenzaStudentMarketplace/1.0' },
    });
    if (!res.ok) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    const data = await res.json();
    return data.display_name?.split(',')[0] ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
}

// ── Status display helpers ─────────────────────────────────────────────────

const STATUS_LABEL: Record<BookingStatus, string> = {
  // DIRECT
  REQUESTED:          'Awaiting Response',
  QUOTED:             'Quote Received',
  ACCEPTED:           'Confirmed',
  DECLINED:           'Declined',
  EXPIRED:            'Expired',
  NO_SHOW:            'No-show',
  // ESCROW + shared
  AWAITING_KYC:       'Awaiting Verification',
  PENDING_PAYMENT:    'Awaiting Payment',
  FUNDS_HELD:         'Payment Held',
  IN_PROGRESS:        'In Progress',
  DELIVERED:          'Delivered',
  COMPLETED:          'Completed',
  DISPUTED:           'Disputed',
  CHARGEBACK_PENDING: 'Chargeback',
  DISBURSED:          'Paid Out',
  CANCELLED:          'Cancelled',
};

const STATUS_COLOR: Record<BookingStatus, string> = {
  REQUESTED:          palette.textSecondary,
  QUOTED:             palette.warning,
  ACCEPTED:           palette.primary,
  DECLINED:           palette.textSecondary,
  EXPIRED:            palette.textSecondary,
  NO_SHOW:            palette.danger,
  AWAITING_KYC:       palette.warning,
  PENDING_PAYMENT:    palette.warning,
  FUNDS_HELD:         palette.primary,
  IN_PROGRESS:        palette.primary,
  DELIVERED:          palette.secondary,
  COMPLETED:          palette.success,
  DISPUTED:           palette.danger,
  CHARGEBACK_PENDING: palette.danger,
  DISBURSED:          palette.success,
  CANCELLED:          palette.textSecondary,
};

const STATUS_BG: Record<BookingStatus, string> = {
  REQUESTED:          palette.background,
  QUOTED:             palette.warningLight,
  ACCEPTED:           palette.primaryLight,
  DECLINED:           palette.background,
  EXPIRED:            palette.background,
  NO_SHOW:            palette.dangerLight,
  AWAITING_KYC:       palette.warningLight,
  PENDING_PAYMENT:    palette.warningLight,
  FUNDS_HELD:         palette.primaryLight,
  IN_PROGRESS:        palette.primaryLight,
  DELIVERED:          '#E8F5F2',
  COMPLETED:          palette.successLight,
  DISPUTED:           palette.dangerLight,
  CHARGEBACK_PENDING: palette.dangerLight,
  DISBURSED:          palette.successLight,
  CANCELLED:          palette.background,
};

const SAFETY_CATEGORIES = [
  { label: 'Harassment',       value: 'HARASSMENT' },
  { label: 'Violence / Threat', value: 'VIOLENCE_THREAT' },
  { label: 'Unsafe Behaviour', value: 'UNSAFE_BEHAVIOR' },
  { label: 'Discrimination',   value: 'DISCRIMINATION' },
  { label: 'Stolen Property',  value: 'STOLEN_PROPERTY' },
  { label: 'Other',            value: 'OTHER' },
];

const DISPUTE_CATEGORIES = [
  { label: 'Not Delivered',  value: 'NOT_DELIVERED' },
  { label: 'Quality Issue',  value: 'QUALITY_ISSUE' },
  { label: 'Wrong Item',     value: 'WRONG_ITEM' },
  { label: 'Damage',         value: 'DAMAGE' },
  { label: 'No Show',        value: 'NO_SHOW' },
  { label: 'Safety Concern', value: 'SAFETY' },
  { label: 'Other',          value: 'OTHER' },
];

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-ZM', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function payoutCountdown(eligibleAt: string): string {
  const diff = new Date(eligibleAt).getTime() - Date.now();
  if (diff <= 0) return 'Payout due now';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `Payout in ${h}h ${m}m` : `Payout in ${m}m`;
}

export default function BookingDetailScreen({ navigation, route }: any) {
  const bookingId: string = route.params?.bookingId;
  const insets = useSafeAreaInsets();
  const { showError } = useSnackbar();
  const { user } = useAuthStore();
  const {
    pay, start, deliver, complete, cancel, submitting, error, clearError,
    accept, quote, decline, acceptQuote, markPaid, review,
  } = useBookingStore();

  const [booking, setBooking]               = useState<Booking | null>(null);
  const [loading, setLoading]               = useState(true);
  const [locationName, setLocationName]     = useState<string | null>(null);
  const [showDispute, setShowDispute]         = useState(false);
  const [disputeCategory, setDisputeCategory] = useState(DISPUTE_CATEGORIES[0].value);
  const [disputeText, setDisputeText]         = useState('');
  const [disputeEvidence, setDisputeEvidence] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [showSafetyReport, setShowSafetyReport] = useState(false);
  const [safetyCategory, setSafetyCategory]   = useState<SafetyCategory>('HARASSMENT');
  const [safetyText, setSafetyText]           = useState('');
  const [tosAcknowledged, setTosAcknowledged] = useState(false);
  const [actionLoading, setActionLoading]     = useState(false);
  const [showQuote, setShowQuote]             = useState(false);
  const [quotePrice, setQuotePrice]           = useState('');
  const [reviewRating, setReviewRating]       = useState(0);
  const [reviewComment, setReviewComment]     = useState('');

  useEffect(() => { loadBooking(); }, [bookingId]);

  useEffect(() => {
    if (error) { showError(error.message); clearError(); }
  }, [error]);

  useEffect(() => {
    if (booking?.delivery_lat != null && booking?.delivery_lng != null) {
      reverseGeocodeName(booking.delivery_lat, booking.delivery_lng).then(setLocationName);
    }
  }, [booking?.id]);

  async function loadBooking() {
    try {
      const b = await bookingsApi.get(bookingId);
      setBooking(b);
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Failed to load booking.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: () => Promise<Booking>) {
    setActionLoading(true);
    try {
      const updated = await action();
      setBooking(updated);
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Action failed.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDispute() {
    if (disputeText.trim().length < 20) {
      showError('Please describe the issue in at least 20 characters.');
      return;
    }
    setActionLoading(true);
    try {
      const result = await bookingsApi.dispute(bookingId, {
        reason_category: disputeCategory,
        description:     disputeText.trim(),
      });
      setBooking(result.booking);
      setShowDispute(false);
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Failed to open dispute.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleInstantPayout() {
    setActionLoading(true);
    try {
      const updated = await bookingsApi.instantPayout(bookingId);
      setBooking(updated);
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Instant payout failed.');
    } finally {
      setActionLoading(false);
    }
  }

  async function pickEvidence() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: 5,
    });
    if (!result.canceled) {
      setDisputeEvidence((prev) => [...prev, ...result.assets].slice(0, 5));
    }
  }

  async function handleSafetyReport() {
    if (!booking) return;
    if (safetyText.trim().length < 20) {
      showError('Please describe the issue in at least 20 characters.');
      return;
    }
    if (!tosAcknowledged) {
      showError('You must acknowledge the terms before submitting.');
      return;
    }
    setActionLoading(true);
    try {
      await safetyReportsApi.file({
        reported_id:      booking.provider.id,
        booking_id:       booking.id,
        category:         safetyCategory,
        description:      safetyText.trim(),
        tos_acknowledged: true,
      });
      setShowSafetyReport(false);
      Alert.alert(
        'Report submitted',
        'Our moderation team will review this within 1 hour. The provider\'s account has been temporarily restricted.',
      );
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Failed to submit report.');
    } finally {
      setActionLoading(false);
    }
  }

  function handleEmergency() {
    Alert.alert(
      'Emergency',
      'This will call Zambia Emergency Services (991). Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call 991',
          style: 'destructive',
          onPress: () => Linking.openURL('tel:991'),
        },
      ],
    );
  }

  function confirmAction(title: string, message: string, action: () => Promise<Booking>) {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: () => handleAction(action) },
    ]);
  }

  const isMyBookingAsBuyer    = booking?.buyer.id    === user?.id;
  const isMyBookingAsProvider = booking?.provider.id === user?.id;
  const isDirect = (booking?.payment_mode ?? 'ESCROW') === 'DIRECT';
  const busy = submitting || actionLoading;

  async function handleQuoteSubmit() {
    const price = Number(quotePrice);
    if (!Number.isFinite(price) || price <= 0) {
      showError('Enter a valid amount above ZMW 0.');
      return;
    }
    await handleAction(() => quote(booking!.id, price));
    setShowQuote(false);
    setQuotePrice('');
  }

  async function handleSubmitReview() {
    if (reviewRating < 1) {
      showError('Please tap a star rating before submitting.');
      return;
    }
    setActionLoading(true);
    try {
      const updated = await review(booking!.id, reviewRating, reviewComment.trim() || undefined);
      setBooking(updated);
      Alert.alert('Thanks for your review', 'Your feedback helps other customers and the provider.');
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Could not submit your review.');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.navBar}>
        <TouchableRipple onPress={() => navigation.goBack()} borderless style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={palette.textPrimary} />
        </TouchableRipple>
        <Text style={styles.navTitle}>Booking details</Text>
        <View style={styles.backBtnPlaceholder} />
      </View>

      {loading || !booking ? (
        <View style={styles.skeletons}>
          <CardSkeleton style={styles.skeletonSm} />
          <CardSkeleton style={styles.skeletonLg} />
          <CardSkeleton style={styles.skeletonSm} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Status badge */}
          <View style={[styles.statusBadge, { backgroundColor: STATUS_BG[booking.status] }]}>
            <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[booking.status] }]} />
            <Text style={[styles.statusText, { color: STATUS_COLOR[booking.status] }]}>
              {STATUS_LABEL[booking.status]}
            </Text>
          </View>

          {/* Payout countdown (provider, COMPLETED) — escrow only */}
          {!isDirect && isMyBookingAsProvider && booking.status === 'COMPLETED' && booking.payout_eligible_at && (
            <View style={styles.countdownBanner}>
              <Ionicons name="timer-outline" size={16} color={palette.primary} />
              <Text style={styles.countdownText}>{payoutCountdown(booking.payout_eligible_at)}</Text>
            </View>
          )}

          {/* Service card */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Service</Text>
            <Text style={styles.cardValue}>{booking.service.title}</Text>
            <View style={styles.priceRow}>
              <Text style={styles.cardSub}>
                ZMW {(booking.agreed_amount ?? booking.amount ?? booking.service.base_price).toFixed(2)}
              </Text>
              {isDirect && booking.status === 'QUOTED' && (
                <Text style={styles.protectionFee}>quoted</Text>
              )}
              {booking.buyer_protection_fee > 0 && isMyBookingAsBuyer && (
                <Text style={styles.protectionFee}>
                  + ZMW {booking.buyer_protection_fee.toFixed(2)} protection
                </Text>
              )}
            </View>
          </View>

          {/* Schedule card */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Schedule</Text>
            <View style={styles.scheduleRow}>
              <Ionicons name="time-outline" size={14} color={palette.textSecondary} />
              <Text style={styles.cardSub}>{fmtDateTime(booking.scheduled_start)}</Text>
            </View>
            <Text style={styles.scheduleArrow}>→ {fmtDateTime(booking.scheduled_end)}</Text>
            {locationName != null && (
              <View style={[styles.scheduleRow, { marginTop: 6 }]}>
                <Ionicons name="location-outline" size={14} color={palette.textSecondary} />
                <Text style={styles.cardSub}>{locationName}</Text>
              </View>
            )}
          </View>

          {/* Parties */}
          <View style={styles.card}>
            <View style={styles.partyRow}>
              <View style={styles.partyBlock}>
                <Text style={styles.cardLabel}>Buyer</Text>
                <Text style={styles.cardSub}>{booking.buyer.email}</Text>
              </View>
              <View style={styles.partyDivider} />
              <View style={styles.partyBlock}>
                <Text style={styles.cardLabel}>Provider</Text>
                <Text style={styles.cardSub}>{booking.provider.email}</Text>
              </View>
            </View>
          </View>

          {/* Commission breakdown (provider only, after COMPLETED) */}
          {isMyBookingAsProvider && booking.commission && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Earnings breakdown</Text>
              <CommissionRow label="Gross amount"   value={booking.commission.gross_amount} />
              <CommissionRow label={`Commission (${(booking.commission.commission_rate * 100).toFixed(0)}%)`} value={-booking.commission.commission_amount} danger />
              {booking.commission.vat > 0 && (
                <CommissionRow label="VAT on commission" value={-booking.commission.vat} danger />
              )}
              <View style={styles.commissionDivider} />
              <CommissionRow label="You receive" value={booking.commission.net_to_provider} bold />
            </View>
          )}

          {/* Payment / transaction card */}
          {booking.transactions && booking.transactions.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Transactions</Text>
              {booking.transactions.map((tx) => {
                const statusColor =
                  tx.status === 'SUCCESS' ? palette.success :
                  tx.status === 'FAILED'  ? palette.danger  :
                  tx.status === 'FROZEN'  ? palette.warning  : palette.warning;
                const typeLabel =
                  tx.type === 'PAY_IN'  ? 'Payment in' :
                  tx.type === 'PAY_OUT' ? 'Payout'     : 'Refund';
                return (
                  <View key={tx.id} style={styles.txRow}>
                    <View style={styles.txLeft}>
                      <Text style={styles.txType}>{typeLabel}</Text>
                      <Text style={[styles.txStatus, { color: statusColor }]}>{tx.status}</Text>
                    </View>
                    <View style={styles.txRight}>
                      <Text style={styles.txAmount}>ZMW {tx.amount_gross.toFixed(2)}</Text>
                      {tx.type === 'PAY_OUT' && (
                        <Text style={styles.txNet}>Net: ZMW {tx.amount_net.toFixed(2)}</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Active dispute info */}
          {booking.dispute && (
            <View style={[styles.card, styles.disputeCard]}>
              <Text style={[styles.cardLabel, { color: palette.danger }]}>
                Dispute — {booking.dispute.status.replace(/_/g, ' ')}
              </Text>
              <Text style={styles.disputeReason}>{booking.dispute.description}</Text>
              {booking.dispute.resolution_notes ? (
                <Text style={[styles.cardSub, { marginTop: 6 }]}>
                  Resolution: {booking.dispute.resolution_notes}
                </Text>
              ) : null}
            </View>
          )}

          {/* ── Action buttons ── */}

          {/* DIRECT — Provider: respond to a new request */}
          {isDirect && isMyBookingAsProvider && booking.status === 'REQUESTED' && (
            <>
              <Button
                mode="contained"
                style={styles.actionBtn}
                contentStyle={styles.actionBtnContent}
                labelStyle={styles.actionBtnLabel}
                loading={busy} disabled={busy}
                onPress={() => confirmAction(
                  'Accept request',
                  `Accept this booking at ZMW ${(booking.amount ?? booking.service.base_price).toFixed(2)}? This confirms the job — the customer pays you directly.`,
                  () => accept(booking.id),
                )}
              >
                Accept · ZMW {(booking.amount ?? booking.service.base_price).toFixed(0)}
              </Button>
              <Button
                mode="outlined"
                style={[styles.actionBtn, { borderColor: palette.primary }]}
                contentStyle={styles.actionBtnContent}
                labelStyle={styles.actionBtnLabel}
                disabled={busy}
                textColor={palette.primary}
                onPress={() => { setQuotePrice(String(booking.amount ?? booking.service.base_price ?? '')); setShowQuote(true); }}
              >
                Send a quote
              </Button>
              <Button
                mode="text"
                style={{ marginTop: spacing.xs }}
                labelStyle={[styles.actionBtnLabel, { color: palette.danger }]}
                disabled={busy}
                textColor={palette.danger}
                onPress={() => confirmAction(
                  'Decline request',
                  'Decline this booking? The customer will be notified.',
                  () => decline(booking.id),
                )}
              >
                Decline
              </Button>
            </>
          )}

          {/* DIRECT — Buyer: provider sent a quote */}
          {isDirect && isMyBookingAsBuyer && booking.status === 'QUOTED' && (
            <>
              <Button
                mode="contained"
                style={styles.actionBtn}
                contentStyle={styles.actionBtnContent}
                labelStyle={styles.actionBtnLabel}
                loading={busy} disabled={busy}
                onPress={() => confirmAction(
                  'Accept quote',
                  `Accept the provider's quote of ZMW ${(booking.agreed_amount ?? 0).toFixed(2)}? This confirms the booking — you'll pay the provider directly.`,
                  () => acceptQuote(booking.id),
                )}
              >
                Accept quote · ZMW {(booking.agreed_amount ?? 0).toFixed(0)}
              </Button>
              <Button
                mode="text"
                style={{ marginTop: spacing.xs }}
                labelStyle={[styles.actionBtnLabel, { color: palette.danger }]}
                disabled={busy}
                textColor={palette.danger}
                onPress={() => confirmAction(
                  'Decline quote',
                  'Decline this quote and cancel the request?',
                  () => cancel(booking.id),
                )}
              >
                Decline quote
              </Button>
            </>
          )}

          {/* DIRECT — Buyer: waiting on provider to respond */}
          {isDirect && isMyBookingAsBuyer && booking.status === 'REQUESTED' && (
            <View style={styles.waitNote}>
              <Ionicons name="hourglass-outline" size={16} color={palette.textSecondary} />
              <Text style={styles.waitNoteText}>Waiting for the provider to accept your request.</Text>
            </View>
          )}

          {/* DIRECT — either party: informational "mark as paid" record */}
          {isDirect &&
            ['ACCEPTED', 'IN_PROGRESS', 'DELIVERED'].includes(booking.status) &&
            booking.payment_status !== 'MARKED_PAID' && (
            <Button
              mode="outlined"
              style={[styles.actionBtn, { borderColor: palette.primary }]}
              contentStyle={styles.actionBtnContent}
              labelStyle={styles.actionBtnLabel}
              loading={busy} disabled={busy}
              textColor={palette.primary}
              onPress={() => confirmAction(
                'Mark as paid',
                'Record that payment was made directly between you and the other party. This is for your records only — no money moves through the app.',
                () => markPaid(booking.id),
              )}
            >
              Mark as paid
            </Button>
          )}

          {isDirect && booking.payment_status === 'MARKED_PAID' && (
            <View style={styles.waitNote}>
              <Ionicons name="checkmark-circle-outline" size={16} color={palette.success} />
              <Text style={[styles.waitNoteText, { color: palette.success }]}>Marked as paid directly.</Text>
            </View>
          )}

          {/* Buyer: pay */}
          {isMyBookingAsBuyer && booking.status === 'PENDING_PAYMENT' && (
            <Button
              mode="contained"
              style={styles.actionBtn}
              contentStyle={styles.actionBtnContent}
              labelStyle={styles.actionBtnLabel}
              loading={busy} disabled={busy}
              onPress={() => confirmAction(
                'Confirm Payment',
                `ZMW ${(booking.amount ?? booking.service.base_price).toFixed(2)} will be held until the service is delivered. A ZMW ${booking.buyer_protection_fee.toFixed(2)} buyer protection fee also applies.`,
                () => pay(booking.id),
              )}
            >
              Pay & Hold Funds
            </Button>
          )}

          {/* Provider: start (DIRECT: ACCEPTED → IN_PROGRESS · ESCROW: FUNDS_HELD → IN_PROGRESS) */}
          {isMyBookingAsProvider && (booking.status === 'FUNDS_HELD' || booking.status === 'ACCEPTED') && (
            <Button
              mode="contained"
              style={styles.actionBtn}
              contentStyle={styles.actionBtnContent}
              labelStyle={styles.actionBtnLabel}
              loading={busy} disabled={busy}
              onPress={() => handleAction(() => start(booking.id))}
            >
              Mark as Started
            </Button>
          )}

          {/* Provider: deliver */}
          {isMyBookingAsProvider && booking.status === 'IN_PROGRESS' && (
            <Button
              mode="contained"
              style={styles.actionBtn}
              contentStyle={styles.actionBtnContent}
              labelStyle={styles.actionBtnLabel}
              loading={busy} disabled={busy}
              onPress={() => handleAction(() => deliver(booking.id))}
            >
              Mark as Delivered
            </Button>
          )}

          {/* Buyer: complete or dispute */}
          {isMyBookingAsBuyer && booking.status === 'DELIVERED' && (
            <>
              <Button
                mode="contained"
                style={styles.actionBtn}
                contentStyle={styles.actionBtnContent}
                labelStyle={styles.actionBtnLabel}
                loading={busy} disabled={busy}
                onPress={() => confirmAction(
                  'Confirm Completion',
                  isDirect
                    ? 'Confirm the job is done. This closes the booking and lets you leave a review. No money moves through the app.'
                    : 'This releases funds to the provider. The action cannot be undone.',
                  () => complete(booking.id),
                )}
              >
                {isDirect ? 'Confirm completion' : 'Confirm & Release Funds'}
              </Button>

              {!showDispute ? (
                <Button
                  mode="outlined"
                  style={[styles.actionBtn, styles.actionBtnOutline]}
                  contentStyle={styles.actionBtnContent}
                  labelStyle={[styles.actionBtnLabel, { color: palette.danger }]}
                  onPress={() => setShowDispute(true)}
                  textColor={palette.danger}
                >
                  Raise a Dispute
                </Button>
              ) : (
                <View style={styles.disputeInput}>
                  <Text style={styles.cardLabel}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      {DISPUTE_CATEGORIES.map((cat) => (
                        <TouchableRipple
                          key={cat.value}
                          onPress={() => setDisputeCategory(cat.value)}
                          borderless
                          style={[
                            styles.catChip,
                            disputeCategory === cat.value && styles.catChipSelected,
                          ]}
                        >
                          <Text style={[
                            styles.catChipText,
                            disputeCategory === cat.value && { color: '#fff' },
                          ]}>
                            {cat.label}
                          </Text>
                        </TouchableRipple>
                      ))}
                    </View>
                  </ScrollView>

                  <Text style={styles.cardLabel}>Describe the issue</Text>
                  <TextInput
                    style={styles.textArea}
                    multiline
                    numberOfLines={4}
                    placeholder="What went wrong? (min. 20 characters)"
                    placeholderTextColor={palette.textDisabled}
                    value={disputeText}
                    onChangeText={setDisputeText}
                  />
                  <Button
                    mode="contained"
                    buttonColor={palette.danger}
                    style={{ borderRadius: r.lg, marginTop: spacing.sm }}
                    contentStyle={styles.actionBtnContent}
                    labelStyle={styles.actionBtnLabel}
                    loading={busy}
                    disabled={busy || disputeText.trim().length < 20}
                    onPress={handleDispute}
                  >
                    Submit Dispute
                  </Button>
                  <Button
                    mode="text"
                    textColor={palette.textSecondary}
                    onPress={() => setShowDispute(false)}
                  >
                    Cancel
                  </Button>
                </View>
              )}
            </>
          )}

          {/* Provider: instant payout (COMPLETED, hold not yet expired) — escrow only */}
          {!isDirect &&
           isMyBookingAsProvider &&
           booking.status === 'COMPLETED' &&
           !booking.instant_payout_requested &&
           booking.payout_eligible_at &&
           new Date(booking.payout_eligible_at) > new Date() && (
            <Button
              mode="outlined"
              style={[styles.actionBtn, { borderColor: palette.primary }]}
              contentStyle={styles.actionBtnContent}
              labelStyle={styles.actionBtnLabel}
              loading={busy} disabled={busy}
              onPress={() => Alert.alert(
                'Instant Payout',
                'A 1% fee will be deducted from your payout to skip the hold period.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Proceed', onPress: handleInstantPayout },
                ],
              )}
            >
              Request Instant Payout (1% fee)
            </Button>
          )}

          {/* Buyer: leave a review (COMPLETED / DISBURSED, not yet reviewed) */}
          {isMyBookingAsBuyer && ['COMPLETED', 'DISBURSED'].includes(booking.status) && !booking.has_review && (
            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>Rate your experience</Text>
              <Text style={styles.reviewSub}>How was your booking with {booking.provider.display_name ?? 'the provider'}?</Text>
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <TouchableRipple
                    key={n}
                    borderless
                    style={styles.starBtn}
                    onPress={() => setReviewRating(n)}
                    accessibilityRole="button"
                    accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
                  >
                    <Ionicons
                      name={n <= reviewRating ? 'star' : 'star-outline'}
                      size={34}
                      color={n <= reviewRating ? palette.warning : palette.textDisabled}
                    />
                  </TouchableRipple>
                ))}
              </View>
              <TextInput
                style={styles.textArea}
                multiline
                numberOfLines={3}
                placeholder="Add a comment (optional)"
                placeholderTextColor={palette.textDisabled}
                value={reviewComment}
                onChangeText={setReviewComment}
              />
              <Button
                mode="contained"
                style={[styles.actionBtn, { marginTop: spacing.sm }]}
                contentStyle={styles.actionBtnContent}
                labelStyle={styles.actionBtnLabel}
                loading={busy}
                disabled={busy || reviewRating < 1}
                onPress={handleSubmitReview}
              >
                Submit review
              </Button>
            </View>
          )}

          {/* Buyer: already reviewed */}
          {isMyBookingAsBuyer && ['COMPLETED', 'DISBURSED'].includes(booking.status) && booking.has_review && (
            <View style={styles.waitNote}>
              <Ionicons name="checkmark-circle-outline" size={16} color={palette.success} />
              <Text style={[styles.waitNoteText, { color: palette.success }]}>Thanks — you’ve reviewed this booking.</Text>
            </View>
          )}

          {/* Buyer: cancel (before IN_PROGRESS) */}
          {isMyBookingAsBuyer && ['PENDING_PAYMENT', 'FUNDS_HELD', 'REQUESTED', 'ACCEPTED'].includes(booking.status) && (
            <Button
              mode="text"
              style={{ marginTop: spacing.sm }}
              labelStyle={[styles.actionBtnLabel, { color: palette.danger }]}
              loading={busy} disabled={busy}
              onPress={() => confirmAction(
                'Cancel Booking',
                booking.status === 'FUNDS_HELD'
                  ? 'A refund will be issued to your account.'
                  : isDirect && booking.status === 'ACCEPTED'
                    ? 'Cancelling a confirmed booking may affect your account rating. Continue?'
                    : 'Are you sure you want to cancel?',
                () => cancel(booking.id),
              )}
              textColor={palette.danger}
            >
              Cancel Booking
            </Button>
          )}

          {/* ── Safety section (visible during any active booking) ── */}
          {['FUNDS_HELD', 'ACCEPTED', 'IN_PROGRESS', 'DELIVERED'].includes(booking.status) && (
            <View style={styles.safetySection}>
              {/* Emergency button — §11.4 */}
              {booking.status === 'IN_PROGRESS' && (
                <TouchableRipple
                  onPress={handleEmergency}
                  borderless
                  style={styles.emergencyBtn}
                >
                  <View style={styles.emergencyBtnInner}>
                    <Ionicons name="alert-circle" size={22} color="#fff" />
                    <Text style={styles.emergencyBtnText}>Emergency — Call 991</Text>
                  </View>
                </TouchableRipple>
              )}

              {/* Safety report — §11.3 */}
              {!showSafetyReport ? (
                <Button
                  mode="text"
                  textColor={palette.danger}
                  labelStyle={{ fontSize: 13 }}
                  onPress={() => setShowSafetyReport(true)}
                >
                  Report a safety concern
                </Button>
              ) : (
                <View style={styles.disputeInput}>
                  <Text style={[styles.cardLabel, { color: palette.danger, marginBottom: spacing.sm }]}>
                    Safety Report
                  </Text>

                  <Text style={styles.cardLabel}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      {SAFETY_CATEGORIES.map((cat) => (
                        <TouchableRipple
                          key={cat.value}
                          onPress={() => setSafetyCategory(cat.value as SafetyCategory)}
                          borderless
                          style={[styles.catChip, safetyCategory === cat.value && styles.catChipSafety]}
                        >
                          <Text style={[styles.catChipText, safetyCategory === cat.value && { color: '#fff' }]}>
                            {cat.label}
                          </Text>
                        </TouchableRipple>
                      ))}
                    </View>
                  </ScrollView>

                  <Text style={styles.cardLabel}>Describe what happened</Text>
                  <TextInput
                    style={styles.textArea}
                    multiline numberOfLines={4}
                    placeholder="Describe the safety concern (min. 20 characters)"
                    placeholderTextColor={palette.textDisabled}
                    value={safetyText}
                    onChangeText={setSafetyText}
                  />

                  <TouchableRipple
                    onPress={() => setTosAcknowledged(!tosAcknowledged)}
                    borderless
                    style={styles.tosRow}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Ionicons
                        name={tosAcknowledged ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={tosAcknowledged ? palette.danger : palette.textSecondary}
                      />
                      <Text style={styles.tosText}>
                        I understand that filing a false safety report may result in my account being restricted.
                      </Text>
                    </View>
                  </TouchableRipple>

                  <Button
                    mode="contained"
                    buttonColor={palette.danger}
                    style={{ borderRadius: r.lg, marginTop: spacing.sm }}
                    contentStyle={styles.actionBtnContent}
                    labelStyle={styles.actionBtnLabel}
                    loading={busy}
                    disabled={busy || safetyText.trim().length < 20 || !tosAcknowledged}
                    onPress={handleSafetyReport}
                  >
                    Submit Safety Report
                  </Button>
                  <Button
                    mode="text"
                    textColor={palette.textSecondary}
                    onPress={() => setShowSafetyReport(false)}
                  >
                    Cancel
                  </Button>
                </View>
              )}
            </View>
          )}

          {/* Evidence upload for open disputes */}
          {booking.dispute && ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE'].includes(booking.dispute.status) &&
           isMyBookingAsBuyer && (
            <View style={[styles.card, { borderColor: palette.warning + '88' }]}>
              <Text style={styles.cardLabel}>Add Evidence</Text>
              <Text style={[styles.cardSub, { marginBottom: spacing.sm }]}>
                Upload photos or receipts to support your dispute ({disputeEvidence.length}/5 selected).
              </Text>
              <Button
                mode="outlined"
                icon="camera"
                style={{ borderRadius: r.md, marginBottom: spacing.xs }}
                onPress={pickEvidence}
                disabled={disputeEvidence.length >= 5}
              >
                Choose Photos
              </Button>
              {disputeEvidence.length > 0 && (
                <Button
                  mode="contained"
                  style={{ borderRadius: r.md }}
                  contentStyle={styles.actionBtnContent}
                  labelStyle={styles.actionBtnLabel}
                  loading={busy} disabled={busy}
                  onPress={async () => {
                    if (!booking.dispute) return;
                    setActionLoading(true);
                    try {
                      await safetyReportsApi.uploadEvidence(
                        booking.dispute.id,
                        disputeEvidence.map((a) => ({
                          uri: a.uri, name: a.fileName ?? 'photo.jpg', type: a.mimeType ?? 'image/jpeg',
                        })),
                      );
                      setDisputeEvidence([]);
                      Alert.alert('Uploaded', 'Your evidence has been submitted.');
                    } catch (e) {
                      showError(e instanceof ApiError ? e.message : 'Upload failed.');
                    } finally {
                      setActionLoading(false);
                    }
                  }}
                >
                  Upload {disputeEvidence.length} Photo{disputeEvidence.length !== 1 ? 's' : ''}
                </Button>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* DIRECT — provider quote dialog */}
      <Portal>
        <Dialog visible={showQuote} onDismiss={() => setShowQuote(false)}>
          <Dialog.Title>Send a quote</Dialog.Title>
          <Dialog.Content>
            <Text style={{ ...typography.bodySmall, color: palette.textSecondary, marginBottom: spacing.sm }}>
              Propose your price for this job. The customer pays you directly if they accept.
            </Text>
            <PaperTextInput
              mode="outlined"
              keyboardType="numeric"
              value={quotePrice}
              onChangeText={(t) => setQuotePrice(t.replace(/[^0-9.]/g, ''))}
              left={<PaperTextInput.Affix text="ZMW" />}
              placeholder="Your price"
              autoFocus
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setShowQuote(false)}>Cancel</Button>
            <Button
              mode="contained"
              loading={busy}
              disabled={busy || quotePrice.trim() === '' || Number(quotePrice) <= 0}
              onPress={handleQuoteSubmit}
            >
              Send quote
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

// ── Commission row helper ──────────────────────────────────────────────────

function CommissionRow({
  label,
  value,
  danger,
  bold,
}: {
  label: string;
  value: number;
  danger?: boolean;
  bold?: boolean;
}) {
  const color = danger ? palette.danger : bold ? palette.textPrimary : palette.textSecondary;
  return (
    <View style={commStyles.row}>
      <Text style={[commStyles.label, bold && { fontFamily: 'PlusJakartaSans_700Bold' }]}>{label}</Text>
      <Text style={[commStyles.value, { color }, bold && { fontFamily: 'PlusJakartaSans_700Bold' }]}>
        {value < 0 ? '-' : ''}ZMW {Math.abs(value).toFixed(2)}
      </Text>
    </View>
  );
}

const commStyles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  label: { ...typography.bodySmall, color: palette.textSecondary },
  value: { ...typography.bodySmall },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: r.full,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border,
  },
  backBtnPlaceholder: { width: 36 },
  navTitle: { ...typography.label, color: palette.textSecondary },

  skeletons: { paddingHorizontal: spacing.lg, gap: spacing.md },
  skeletonSm: { height: 56, borderRadius: r.md },
  skeletonLg: { height: 120, borderRadius: r.lg },

  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },

  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    alignSelf: 'flex-start', borderRadius: r.full,
    paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  statusDot:  { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...typography.label, fontSize: 13 },

  countdownBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: palette.primaryLight,
    borderRadius: r.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  countdownText: { ...typography.bodySmall, color: palette.primary },

  card: {
    backgroundColor: palette.surface, borderRadius: r.lg,
    borderWidth: 1, borderColor: palette.border,
    padding: spacing.md, marginBottom: spacing.md, ...shadow.card,
  },
  cardLabel: { ...typography.label, color: palette.textSecondary, marginBottom: 4 },
  cardValue: { ...typography.heading3, color: palette.textPrimary, fontSize: 18 },
  cardSub:   { ...typography.bodySmall, color: palette.textSecondary },

  priceRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  protectionFee:  { ...typography.bodySmall, color: palette.textDisabled, fontSize: 11 },

  scheduleRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scheduleArrow:{ ...typography.bodySmall, color: palette.textSecondary, marginLeft: 18 },

  partyRow:     { flexDirection: 'row' },
  partyBlock:   { flex: 1 },
  partyDivider: { width: 1, backgroundColor: palette.border, marginHorizontal: spacing.md },

  commissionDivider: { height: 1, backgroundColor: palette.border, marginVertical: spacing.xs },

  disputeCard:   { borderColor: palette.danger + '44' },
  disputeReason: { ...typography.body, color: palette.textPrimary },

  actionBtn:        { borderRadius: r.lg, marginBottom: spacing.sm },
  actionBtnOutline: { borderColor: palette.danger },
  waitNote: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: palette.background, borderRadius: r.lg,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  waitNoteText: { ...typography.bodySmall, color: palette.textSecondary, flex: 1 },
  reviewCard: {
    backgroundColor: palette.surface, borderRadius: r.lg, borderWidth: 1,
    borderColor: palette.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  reviewTitle: { ...typography.label, color: palette.textPrimary },
  reviewSub:   { ...typography.bodySmall, color: palette.textSecondary, marginTop: 2, marginBottom: spacing.sm },
  starRow:     { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  starBtn:     { padding: spacing.xs, borderRadius: r.full },
  actionBtnContent: { height: 52 },
  actionBtnLabel:   { ...typography.label, fontSize: 15 },

  disputeInput: {
    backgroundColor: palette.surface, borderRadius: r.lg,
    borderWidth: 1, borderColor: palette.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  catChip: {
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: r.full, borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  catChipSelected: { backgroundColor: palette.danger, borderColor: palette.danger },
  catChipText:     { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },
  textArea: {
    ...typography.body, color: palette.textPrimary,
    borderWidth: 1, borderColor: palette.border, borderRadius: r.md,
    padding: spacing.sm, minHeight: 100, textAlignVertical: 'top', marginTop: spacing.xs,
  },

  txRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: palette.border, marginTop: spacing.xs,
  },
  txLeft:   { gap: 2 },
  txRight:  { alignItems: 'flex-end', gap: 2 },
  txType:   { ...typography.label, color: palette.textPrimary, fontSize: 13 },
  txStatus: { ...typography.bodySmall, fontSize: 12 },
  txAmount: { ...typography.label, color: palette.textPrimary, fontSize: 13 },
  txNet:    { ...typography.bodySmall, color: palette.textSecondary },

  // Safety section
  safetySection: {
    marginTop:    spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop:   spacing.md,
    gap:          spacing.sm,
  },
  emergencyBtn: {
    backgroundColor: palette.danger,
    borderRadius:    r.lg,
    overflow:        'hidden',
  },
  emergencyBtnInner: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            spacing.sm,
    paddingVertical: spacing.md,
  },
  emergencyBtnText: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize:   15,
    color:      '#fff',
    letterSpacing: 0.3,
  },
  catChipSafety: { backgroundColor: palette.danger, borderColor: palette.danger },
  tosRow:  { paddingVertical: spacing.xs },
  tosText: { ...typography.bodySmall, color: palette.textSecondary, flex: 1, flexShrink: 1 },
});
