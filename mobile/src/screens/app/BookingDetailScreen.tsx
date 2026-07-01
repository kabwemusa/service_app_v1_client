import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../api/errors';
import { Booking, BookingStatus, bookingsApi } from '../../api/bookings';
import { SafetyCategory, safetyReportsApi } from '../../api/safetyReports';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useBookingStore } from '../../store/bookingStore';
import { palette, radius as r, spacing, typography } from '../../theme';

// ── Display maps ─────────────────────────────────────────────────────────────

const STATUS_META: Record<BookingStatus, { label: string; fg: string; bg: string }> = {
  REQUESTED:          { label: 'Awaiting provider',         fg: palette.warning,       bg: palette.warningLight },
  QUOTED:             { label: 'Quote received',             fg: palette.warning,       bg: palette.warningLight },
  ACCEPTED:           { label: 'Confirmed',                  fg: palette.primary,       bg: palette.primaryLight },
  IN_PROGRESS:        { label: 'In progress',                fg: palette.primary,       bg: palette.primaryLight },
  DELIVERED:          { label: 'Awaiting your confirmation', fg: palette.secondary,     bg: '#F7E9EF' },
  COMPLETED:          { label: 'Completed',                  fg: palette.success,       bg: palette.successLight },
  DISBURSED:          { label: 'Completed',                  fg: palette.success,       bg: palette.successLight },
  DECLINED:           { label: 'Declined',                   fg: palette.textSecondary, bg: palette.background },
  EXPIRED:            { label: 'Expired',                    fg: palette.textSecondary, bg: palette.background },
  CANCELLED:          { label: 'Cancelled',                  fg: palette.textSecondary, bg: palette.background },
  NO_SHOW:            { label: 'No-show',                    fg: palette.danger,        bg: palette.dangerLight },
  DISPUTED:           { label: 'Disputed',                   fg: palette.danger,        bg: palette.dangerLight },
  PENDING_PAYMENT:    { label: 'Awaiting payment',           fg: palette.warning,       bg: palette.warningLight },
  AWAITING_KYC:       { label: 'Awaiting verification',      fg: palette.warning,       bg: palette.warningLight },
  FUNDS_HELD:         { label: 'Payment held',               fg: palette.primary,       bg: palette.primaryLight },
  CHARGEBACK_PENDING: { label: 'Chargeback',                 fg: palette.danger,        bg: palette.dangerLight },
};

const SAFETY_CATEGORIES: { label: string; value: SafetyCategory }[] = [
  { label: 'Harassment',        value: 'HARASSMENT' },
  { label: 'Violence / threat', value: 'VIOLENCE_THREAT' },
  { label: 'Unsafe behaviour',  value: 'UNSAFE_BEHAVIOR' },
  { label: 'Discrimination',    value: 'DISCRIMINATION' },
  { label: 'Stolen property',   value: 'STOLEN_PROPERTY' },
  { label: 'Other',             value: 'OTHER' },
];

const DISPUTE_CATEGORIES: { label: string; value: string }[] = [
  { label: 'Not delivered', value: 'NOT_DELIVERED' },
  { label: 'Quality issue', value: 'QUALITY_ISSUE' },
  { label: 'Wrong item',    value: 'WRONG_ITEM' },
  { label: 'Damage',        value: 'DAMAGE' },
  { label: 'No-show',       value: 'NO_SHOW' },
  { label: 'Safety',        value: 'SAFETY' },
  { label: 'Other',         value: 'OTHER' },
];

const STEP_LABELS = ['Confirmed', 'In progress', 'Completed'] as const;
type StepState = 'done' | 'current' | 'upcoming';

function stepStates(status: BookingStatus): StepState[] {
  switch (status) {
    case 'ACCEPTED':     return ['current', 'upcoming', 'upcoming'];
    // ESCROW: funds held is the "Confirmed" step (the escrow equivalent of ACCEPTED).
    case 'FUNDS_HELD':   return ['current', 'upcoming', 'upcoming'];
    case 'IN_PROGRESS':  return ['done',    'current',  'upcoming'];
    case 'DELIVERED':    return ['done',    'done',     'current'];
    case 'COMPLETED':
    case 'DISBURSED':    return ['done',    'done',     'done'];
    default:             return ['upcoming', 'upcoming', 'upcoming'];
  }
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-ZM', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function autoConfirmCountdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'auto-confirming shortly';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `auto-confirms in ${h}h ${m}m` : `auto-confirms in ${m}m`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function tierLabel(tier: number): string {
  if (tier >= 3) return 'Tier 3';
  if (tier >= 2) return 'Tier 2';
  return 'Tier 1';
}

const TERMINAL: BookingStatus[]  = ['CANCELLED', 'DECLINED', 'EXPIRED', 'NO_SHOW', 'DISPUTED'];
const CANCELLABLE: BookingStatus[] = ['REQUESTED', 'QUOTED', 'ACCEPTED'];
const ACTIVE_DIRECT: BookingStatus[] = ['ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED'];

// ── Main screen ───────────────────────────────────────────────────────────────

export default function BookingDetailScreen({ navigation, route }: any) {
  const bookingId: string = route.params?.bookingId;
  const insets = useSafeAreaInsets();
  const { showError } = useSnackbar();
  const {
    acceptQuote, complete, cancel, markPaid, review, pay,
    submitting, error, clearError,
  } = useBookingStore();

  const [booking, setBooking]   = useState<Booking | null>(null);
  const [loading, setLoading]   = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [copied, setCopied]     = useState(false);

  // Review
  const [reviewRating, setReviewRating]   = useState(0);
  const [reviewComment, setReviewComment] = useState('');

  // Safety report (§11.3)
  const [showSafety, setShowSafety]    = useState(false);
  const [safetyCat, setSafetyCat]      = useState<SafetyCategory>('HARASSMENT');
  const [safetyText, setSafetyText]    = useState('');
  const [tosAck, setTosAck]            = useState(false);

  // Dispute (DELIVERED)
  const [showDispute, setShowDispute]        = useState(false);
  const [disputeCat, setDisputeCat]          = useState(DISPUTE_CATEGORIES[0].value);
  const [disputeText, setDisputeText]        = useState('');

  const scrollRef = useRef<ScrollView>(null);
  const busy = submitting || actionBusy;

  useEffect(() => { if (bookingId) loadBooking(); }, [bookingId]);
  useEffect(() => { if (error) { showError(error.message); clearError(); } }, [error]);

  async function loadBooking() {
    if (!bookingId) return;
    try {
      setBooking(await bookingsApi.get(bookingId));
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Failed to load booking.');
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
      showError(e instanceof ApiError ? e.message : 'Action failed.');
    } finally {
      setActionBusy(false);
    }
  }

  function confirmAction(title: string, message: string, action: () => Promise<Booking>) {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => runAction(action) },
    ]);
  }

  async function handleCopyMomo() {
    if (!booking?.provider.payment?.momo_number) return;
    await Clipboard.setStringAsync(booking.provider.payment.momo_number);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function handleEmergency() {
    Alert.alert(
      'Emergency',
      'Only use this for genuine safety emergencies during the job.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Call emergency services?',
              'This will call Zambia Emergency Services (991).',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Call 991', style: 'destructive', onPress: () => Linking.openURL('tel:991') },
              ],
            ),
        },
      ],
    );
  }

  async function submitReview() {
    if (reviewRating < 1) { showError('Tap a star to rate your experience.'); return; }
    setActionBusy(true);
    try {
      const updated = await review(booking!.id, reviewRating, reviewComment.trim() || undefined);
      setBooking(updated);
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Could not submit your review.');
    } finally {
      setActionBusy(false);
    }
  }

  async function submitSafety() {
    if (!booking) return;
    if (safetyText.trim().length < 20) { showError('Describe the issue in at least 20 characters.'); return; }
    if (!tosAck) { showError('Please acknowledge the terms before submitting.'); return; }
    setActionBusy(true);
    try {
      await safetyReportsApi.file({
        reported_id:      booking.provider.id,
        booking_id:       booking.id,
        category:         safetyCat,
        description:      safetyText.trim(),
        tos_acknowledged: true,
      });
      setShowSafety(false);
      setSafetyText('');
      setTosAck(false);
      Alert.alert('Report submitted', 'Our moderation team will review this within 1 hour.');
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Failed to submit report.');
    } finally {
      setActionBusy(false);
    }
  }

  async function submitDispute() {
    if (!booking) return;
    if (disputeText.trim().length < 20) { showError('Describe the issue in at least 20 characters.'); return; }
    setActionBusy(true);
    try {
      const result = await bookingsApi.dispute(booking.id, {
        reason_category: disputeCat,
        description:     disputeText.trim(),
      });
      setBooking(result.booking);
      setShowDispute(false);
      setDisputeText('');
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Failed to open dispute.');
    } finally {
      setActionBusy(false);
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading || !booking) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <NavBar onBack={() => navigation.goBack()} />
        <View style={styles.skeletons}>
          <CardSkeleton style={styles.skelSm} />
          <CardSkeleton style={styles.skelLg} />
          <CardSkeleton style={styles.skelMd} />
        </View>
      </SafeAreaView>
    );
  }

  const isDirect       = (booking.payment_mode ?? 'ESCROW') === 'DIRECT';
  const meta           = STATUS_META[booking.status];
  const steps          = stepStates(booking.status);
  const total          = booking.agreed_amount ?? booking.amount ?? booking.service.base_price ?? 0;
  const providerName   = booking.provider.display_name?.trim() || booking.provider.email.split('@')[0];
  const tier           = booking.provider.trust_tier ?? 0;
  const hasMomo        = isDirect && !!booking.provider.payment?.momo_number && ACTIVE_DIRECT.includes(booking.status);
  const customerPaid   = !!booking.customer_marked_paid_at;
  const providerPaid   = !!booking.provider_marked_paid_at;
  const fullySettled   = customerPaid && providerPaid;
  const isCancellable  = CANCELLABLE.includes(booking.status);
  const isTerminal     = TERMINAL.includes(booking.status);
  const isQuoted       = booking.status === 'QUOTED';
  const isDelivered    = booking.status === 'DELIVERED';
  const isCompleted    = ['COMPLETED', 'DISBURSED'].includes(booking.status);
  const isInProgress   = booking.status === 'IN_PROGRESS';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <NavBar onBack={() => navigation.goBack()} />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, { paddingBottom: spacing.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Service title + status pill */}
        <Text style={styles.title}>{booking.service.title}</Text>
        <View style={[styles.pill, { backgroundColor: meta.bg }]} accessibilityLabel={`Status: ${meta.label}`}>
          <Text style={[styles.pillText, { color: meta.fg }]}>{meta.label}</Text>
        </View>

        {/* Stepper — only shown on active jobs */}
        {!isTerminal && (
          <Stepper steps={steps} />
        )}

        <Divider />

        {/* ── 1. Provider ──────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Provider</Text>

        <View style={styles.providerRow}>
          {booking.provider.avatar_url ? (
            <Image
              source={{ uri: booking.provider.avatar_url }}
              style={styles.avatar}
              contentFit="cover"
              accessibilityLabel={`${providerName} profile photo`}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitials}>{initials(providerName)}</Text>
            </View>
          )}
          <View style={styles.providerInfo}>
            <Text style={styles.providerName} numberOfLines={1}>{providerName}</Text>
            <View style={styles.providerMeta}>
              {booking.provider.rating != null && (
                <View style={styles.ratingChip}>
                  <Ionicons name="star" size={12} color={palette.warning} />
                  <Text style={styles.ratingText}>{booking.provider.rating.toFixed(1)}</Text>
                  {(booking.provider.reviews ?? 0) > 0 && (
                    <Text style={styles.reviewCount}>({booking.provider.reviews})</Text>
                  )}
                </View>
              )}
              <View style={styles.tierChip}>
                <Text style={styles.tierText}>{tierLabel(tier)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Gated momo number (DIRECT + active booking + provider has number set) */}
        {hasMomo && (
          <View style={styles.momoBlock}>
            <View style={styles.momoTopRow}>
              <Ionicons name="phone-portrait-outline" size={16} color={palette.primary} />
              <Text style={styles.momoHead}>Pay the provider directly</Text>
            </View>
            <View style={styles.momoNumberRow}>
              <View style={styles.momoNetworkChip}>
                <Text style={styles.momoNetworkText}>
                  {booking.provider.payment!.momo_provider ?? 'Mobile money'}
                </Text>
              </View>
              <Text style={styles.momoNumber}>{booking.provider.payment!.momo_number}</Text>
              <TouchableRipple
                onPress={handleCopyMomo}
                borderless
                style={styles.copyBtn}
                accessibilityRole="button"
                accessibilityLabel="Copy number"
              >
                <Ionicons
                  name={copied ? 'checkmark-outline' : 'copy-outline'}
                  size={18}
                  color={copied ? palette.success : palette.primary}
                />
              </TouchableRipple>
            </View>

            {/* Two-party payment status (buttons moved to action bar) */}
            {!fullySettled && (providerPaid || customerPaid) && (
              <Text style={styles.momoPartialNote}>
                {providerPaid && !customerPaid
                  ? 'Provider confirmed payment — please confirm your side.'
                  : 'You confirmed — waiting for provider.'}
              </Text>
            )}
            {fullySettled && (
              <View style={styles.settledRow}>
                <Ionicons name="checkmark-circle" size={16} color={palette.success} />
                <Text style={styles.settledText}>Both sides confirmed payment</Text>
              </View>
            )}
          </View>
        )}

        <Divider />

        {/* ── 2. Payment ────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Payment</Text>

        {isQuoted ? (
          <View style={styles.quoteNote}>
            <Ionicons name="pricetag-outline" size={15} color={palette.warning} />
            <Text style={styles.quoteNoteText}>
              Provider quoted{' '}
              <Text style={{ fontFamily: 'DMSans_500Medium' }}>
                ZMW {(booking.agreed_amount ?? 0).toFixed(2)}
              </Text>
              . Accept to confirm the booking.
            </Text>
          </View>
        ) : (
          <>
            <LineItem label="Amount" value={total} />
            {/* ESCROW-only buyer protection fee (mode-driven, §8.3). */}
            {!isDirect && (booking.buyer_protection_fee ?? 0) > 0 && (
              <LineItem label="Buyer protection (2%)" value={booking.buyer_protection_fee} />
            )}
          </>
        )}

        {isDirect ? (
          <Text style={styles.paymentMode}>Direct payment · no platform escrow</Text>
        ) : (
          <>
            <Text style={styles.paymentMode}>Secured by Sebenza Escrow</Text>
            <Text style={styles.paymentMode}>
              Money-back guarantee — full refund if the job isn’t delivered (§11.1).
            </Text>
          </>
        )}

        <Divider />

        {/* ── 3. Schedule ───────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Schedule</Text>
        <View style={styles.iconLine}>
          <Ionicons name="calendar-outline" size={17} color={palette.textSecondary} />
          <Text style={styles.iconLineText}>{fmtDateTime(booking.scheduled_start)}</Text>
        </View>
        <View style={[styles.iconLine, { marginTop: 2 }]}>
          <Ionicons name="arrow-forward-outline" size={17} color={palette.textDisabled} />
          <Text style={styles.iconLineText}>{fmtDateTime(booking.scheduled_end)}</Text>
        </View>
        {(booking.delivery_location_label || booking.delivery_location_region) && (
          <View style={[styles.iconLine, { marginTop: 6 }]}>
            <Ionicons name="location-outline" size={17} color={palette.textSecondary} />
            <Text style={styles.iconLineText} numberOfLines={2}>
              {[booking.delivery_location_label, booking.delivery_location_region].filter(Boolean).join(', ')}
            </Text>
          </View>
        )}

        {/* DELIVERED — auto-confirm countdown */}
        {isDelivered && booking.auto_release_at && (
          <View style={styles.autoConfirmNote}>
            <Ionicons name="timer-outline" size={14} color={palette.textSecondary} />
            <Text style={styles.autoConfirmText}>{autoConfirmCountdown(booking.auto_release_at)}</Text>
          </View>
        )}

        <Divider />

        {/* ── 4. Notes (if present) ─────────────────────────────────── */}
        {!!booking.notes && (
          <>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.notesText}>{booking.notes}</Text>
            <Divider />
          </>
        )}

        {/* ── 5. Review (COMPLETED + not yet reviewed) ──────────────── */}
        {isCompleted && !booking.has_review && (
          <>
            <Text style={styles.sectionLabel}>Your review</Text>
            <Text style={styles.reviewSub}>How was your experience with {providerName}?</Text>
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
                    size={36}
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
            <Divider />
          </>
        )}

        {isCompleted && booking.has_review && (
          <>
            <View style={styles.reviewedNote}>
              <Ionicons name="checkmark-circle" size={16} color={palette.success} />
              <Text style={styles.reviewedText}>You've reviewed this booking — thank you.</Text>
            </View>
            <Divider />
          </>
        )}

        {/* ── 6. Dispute form (DELIVERED) ───────────────────────────── */}
        {isDelivered && showDispute && !booking.dispute && (
          <>
            <Text style={[styles.sectionLabel, { color: palette.danger }]}>Raise a dispute</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <View style={styles.chipRow}>
                {DISPUTE_CATEGORIES.map((cat) => (
                  <TouchableRipple
                    key={cat.value}
                    onPress={() => setDisputeCat(cat.value)}
                    borderless
                    style={[styles.chip, disputeCat === cat.value && styles.chipDanger]}
                  >
                    <Text style={[styles.chipText, disputeCat === cat.value && styles.chipTextActive]}>
                      {cat.label}
                    </Text>
                  </TouchableRipple>
                ))}
              </View>
            </ScrollView>
            <TextInput
              style={styles.textArea}
              multiline
              numberOfLines={4}
              placeholder="Describe what went wrong (min. 20 characters)"
              placeholderTextColor={palette.textDisabled}
              value={disputeText}
              onChangeText={setDisputeText}
            />
            <View style={styles.formActions}>
              <Button
                mode="text"
                textColor={palette.textSecondary}
                style={{ flex: 1 }}
                onPress={() => { setShowDispute(false); setDisputeText(''); }}
              >
                Cancel
              </Button>
              <Button
                mode="contained"
                buttonColor={palette.danger}
                style={[styles.formBtn, { flex: 2 }]}
                contentStyle={styles.formBtnContent}
                loading={busy}
                disabled={busy || disputeText.trim().length < 20}
                onPress={submitDispute}
              >
                Submit dispute
              </Button>
            </View>
            <Divider />
          </>
        )}

        {/* Active dispute info */}
        {booking.dispute && (
          <>
            <Text style={[styles.sectionLabel, { color: palette.danger }]}>
              Dispute · {booking.dispute.status.replace(/_/g, ' ').toLowerCase()}
            </Text>
            <Text style={styles.notesText}>{booking.dispute.description}</Text>
            {booking.dispute.resolution_notes && (
              <Text style={[styles.notesText, { color: palette.textSecondary, marginTop: 4 }]}>
                Resolution: {booking.dispute.resolution_notes}
              </Text>
            )}
            <Divider />
          </>
        )}

        {/* ── 7. Report an issue ────────────────────────────────────── */}
        {!isTerminal && !showSafety && (
          <TouchableRipple
            onPress={() => setShowSafety(true)}
            borderless
            style={styles.reportRow}
            accessibilityRole="button"
            accessibilityLabel="Report a safety concern"
          >
            <View style={styles.reportInner}>
              <Ionicons name="flag-outline" size={17} color={palette.danger} />
              <Text style={styles.reportText}>Report an issue</Text>
              <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
            </View>
          </TouchableRipple>
        )}

        {showSafety && (
          <View style={styles.safetyForm}>
            <Text style={[styles.sectionLabel, { color: palette.danger }]}>Safety report</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <View style={styles.chipRow}>
                {SAFETY_CATEGORIES.map((cat) => (
                  <TouchableRipple
                    key={cat.value}
                    onPress={() => setSafetyCat(cat.value)}
                    borderless
                    style={[styles.chip, safetyCat === cat.value && styles.chipDanger]}
                  >
                    <Text style={[styles.chipText, safetyCat === cat.value && styles.chipTextActive]}>
                      {cat.label}
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
                  name={tosAck ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={tosAck ? palette.danger : palette.textSecondary}
                />
                <Text style={styles.tosText}>
                  I understand that filing a false safety report may result in my account being restricted.
                </Text>
              </View>
            </TouchableRipple>
            <View style={styles.formActions}>
              <Button
                mode="text"
                textColor={palette.textSecondary}
                style={{ flex: 1 }}
                onPress={() => { setShowSafety(false); setSafetyText(''); setTosAck(false); }}
              >
                Cancel
              </Button>
              <Button
                mode="contained"
                buttonColor={palette.danger}
                style={[styles.formBtn, { flex: 2 }]}
                contentStyle={styles.formBtnContent}
                loading={busy}
                disabled={busy || safetyText.trim().length < 20 || !tosAck}
                onPress={submitSafety}
              >
                Submit report
              </Button>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Sticky action bar ─────────────────────────────────────── */}
      <ActionBar
        booking={booking}
        busy={busy}
        insetBottom={insets.bottom}
        onAcceptQuote={() =>
          confirmAction(
            'Accept quote',
            `Confirm the provider's quote of ZMW ${(booking.agreed_amount ?? 0).toFixed(2)}? You'll pay them directly.`,
            () => acceptQuote(booking.id),
          )
        }
        onDeclineQuote={() =>
          confirmAction(
            'Decline quote',
            'Decline this quote and cancel the request?',
            () => cancel(booking.id),
          )
        }
        onCancel={() =>
          confirmAction(
            'Cancel booking',
            booking.status === 'ACCEPTED'
              ? 'Cancelling a confirmed booking may affect your account rating. Continue?'
              : 'Cancel this booking? The provider will be notified.',
            () => cancel(booking.id),
          )
        }
        onComplete={() =>
          confirmAction(
            isDirect && !customerPaid ? 'Confirm & mark paid' : isDirect ? 'Confirm completion' : 'Confirm & release funds',
            isDirect && !customerPaid
              ? 'Confirm the job is done and that payment has been settled directly with the provider.'
              : isDirect
                ? 'Confirm the job is done. This closes the booking and lets you leave a review.'
                : 'This releases the funds held in escrow to the provider. The action cannot be undone.',
            async () => {
              const updated = await complete(booking.id);
              if (isDirect && !customerPaid) {
                return await markPaid(updated.id);
              }
              return updated;
            },
          )
        }
        onPay={() =>
          confirmAction(
            'Hold funds in escrow',
            `We'll send a mobile-money prompt to your phone for ZMW ${(total + (booking.buyer_protection_fee ?? 0)).toFixed(2)} (incl. ${(booking.buyer_protection_fee ?? 0).toFixed(2)} buyer protection). Approve it to hold the funds securely until the job is done.`,
            () => pay(booking.id),
          )
        }
        onEmergency={handleEmergency}
        onRaiseDispute={() => {
          setShowDispute(true);
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
        }}
        onSubmitReview={submitReview}
        onBookAgain={() =>
          navigation.navigate('ServiceDetail', { serviceId: booking.service.id })
        }
        onMarkPaid={() =>
          confirmAction(
            'Mark as paid',
            "Record that you've paid the provider directly. This is for your records only — no money moves through the app.",
            () => markPaid(booking.id),
          )
        }
        reviewRating={reviewRating}
        hasReview={!!booking.has_review}
        isDirect={isDirect}
        customerPaid={customerPaid}
      />
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NavBar({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableRipple onPress={onBack} borderless style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="arrow-back" size={22} color={palette.textPrimary} />
      </TouchableRipple>
      <Text style={styles.headerTitle}>Booking</Text>
      <View style={styles.iconBtn} />
    </View>
  );
}

function Stepper({ steps }: { steps: StepState[] }) {
  return (
    <View style={styles.stepper} accessibilityRole="progressbar">
      {STEP_LABELS.map((label, i) => {
        const state = steps[i];
        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <View style={[styles.stepConnector, state !== 'upcoming' && styles.stepConnectorDone]} />
            )}
            <View style={styles.stepNode}>
              <View style={[
                styles.stepCircle,
                state === 'done'    && styles.stepCircleDone,
                state === 'current' && styles.stepCircleCurrent,
              ]}>
                {state === 'done' ? (
                  <Ionicons name="checkmark" size={14} color="#fff" />
                ) : (
                  <Text style={[styles.stepNum, state === 'current' && styles.stepNumCurrent]}>
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text style={[styles.stepLabel, state !== 'upcoming' && styles.stepLabelActive]}>
                {label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

function ActionBar({
  booking, busy, insetBottom,
  onAcceptQuote, onDeclineQuote, onCancel,
  onComplete, onEmergency, onRaiseDispute,
  onSubmitReview, onBookAgain, onMarkPaid, onPay,
  reviewRating, hasReview,
  isDirect, customerPaid,
}: {
  booking: Booking;
  busy: boolean;
  insetBottom: number;
  onAcceptQuote: () => void;
  onDeclineQuote: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onEmergency: () => void;
  onRaiseDispute: () => void;
  onSubmitReview: () => void;
  onBookAgain: () => void;
  onMarkPaid: () => void;
  onPay: () => void;
  reviewRating: number;
  hasReview: boolean;
  isDirect: boolean;
  customerPaid: boolean;
}) {
  const { status } = booking;
  const agreedTotal = booking.agreed_amount ?? booking.amount ?? booking.service.base_price ?? 0;
  let content: React.ReactNode = null;

  if (status === 'REQUESTED') {
    // ESCROW: the customer funds the request up front (funding is the commitment).
    // DIRECT: the provider must respond first; the customer just waits.
    content = isDirect ? (
      <>
        <PassiveNote icon="hourglass-outline" text="Waiting for the provider to respond to your request." />
        <Button
          mode="outlined" style={styles.cancelBtn} contentStyle={styles.barBtnContent}
          textColor={palette.danger} disabled={busy}
          onPress={onCancel}
        >
          Cancel request
        </Button>
      </>
    ) : (
      <>
        <Button
          mode="contained" style={styles.primaryBtn} contentStyle={styles.barBtnContent} labelStyle={styles.btnLabel}
          loading={busy} disabled={busy}
          onPress={onPay}
        >
          Pay & hold funds · ZMW {agreedTotal.toFixed(0)}
        </Button>
        <Button
          mode="text" textColor={palette.danger}
          disabled={busy}
          onPress={onCancel}
        >
          Cancel request
        </Button>
      </>
    );
  } else if (status === 'PENDING_PAYMENT') {
    // ESCROW: a mobile-money prompt was sent — let the customer re-send if it lapsed.
    content = (
      <>
        <PassiveNote icon="phone-portrait-outline" text="Check your phone — approve the mobile-money prompt to hold the funds." />
        <Button
          mode="contained" style={styles.primaryBtn} contentStyle={styles.barBtnContent} labelStyle={styles.btnLabel}
          loading={busy} disabled={busy}
          onPress={onPay}
        >
          Resend payment prompt
        </Button>
        <Button
          mode="text" textColor={palette.danger}
          disabled={busy}
          onPress={onCancel}
        >
          Cancel request
        </Button>
      </>
    );
  } else if (status === 'QUOTED') {
    // ESCROW: accepting the quote funds it (Pay). DIRECT: accept then pay provider later.
    content = (
      <>
        <Button
          mode="contained" style={styles.primaryBtn} contentStyle={styles.barBtnContent} labelStyle={styles.btnLabel}
          loading={busy} disabled={busy}
          onPress={isDirect ? onAcceptQuote : onPay}
        >
          {isDirect ? `Accept quote · ZMW ${agreedTotal.toFixed(0)}` : `Accept & pay · ZMW ${agreedTotal.toFixed(0)}`}
        </Button>
        <Button
          mode="text" textColor={palette.danger}
          disabled={busy}
          onPress={onDeclineQuote}
        >
          Decline quote
        </Button>
      </>
    );
  } else if (status === 'FUNDS_HELD') {
    // ESCROW: funds are secured; the provider will start the job.
    content = (
      <>
        <PassiveNote icon="lock-closed-outline" text="Funds held securely in escrow — the provider will start the job shortly." />
        <Button
          mode="outlined" style={styles.cancelBtn} contentStyle={styles.barBtnContent}
          textColor={palette.danger} disabled={busy}
          onPress={onCancel}
        >
          Cancel & refund
        </Button>
      </>
    );
  } else if (status === 'ACCEPTED') {
    content = (
      <>
        <PassiveNote icon="checkmark-circle-outline" text="Booking confirmed — the provider will start shortly." />
        <Button
          mode="outlined" style={styles.cancelBtn} contentStyle={styles.barBtnContent}
          textColor={palette.danger} disabled={busy}
          onPress={onCancel}
        >
          Cancel booking
        </Button>
      </>
    );
  } else if (status === 'IN_PROGRESS') {
    content = (
      <View style={styles.emergencyRow}>
        <Button
          mode="outlined"
          icon="alert-circle-outline"
          style={styles.emergencyBtn}
          contentStyle={styles.barBtnContent}
          textColor={palette.danger}
          disabled={busy}
          onPress={onEmergency}
        >
          Emergency
        </Button>
        <Button
          mode="outlined"
          icon="message-outline"
          style={styles.messageBtn}
          contentStyle={styles.barBtnContent}
          textColor={palette.primary}
          disabled={busy}
          onPress={() =>
            Alert.alert('Coming soon', 'In-app messaging will be available in a future update.')
          }
        >
          Message
        </Button>
      </View>
    );
  } else if (status === 'DELIVERED') {
    content = (
      <>
        <Button
          mode="contained" style={styles.primaryBtn} contentStyle={styles.barBtnContent} labelStyle={styles.btnLabel}
          loading={busy} disabled={busy}
          onPress={onComplete}
        >
          {isDirect && !customerPaid ? 'Confirm & mark paid' : 'Confirm completion'}
        </Button>
        {!booking.dispute && (
          <Button mode="text" textColor={palette.danger} disabled={busy} onPress={onRaiseDispute}>
            Raise a dispute
          </Button>
        )}
      </>
    );
  } else if (status === 'COMPLETED' || status === 'DISBURSED') {
    const needsPay = isDirect && !customerPaid;
    if (needsPay) {
      content = (
        <>
          <Button
            mode="contained" style={styles.primaryBtn} contentStyle={styles.barBtnContent} labelStyle={styles.btnLabel}
            loading={busy} disabled={busy}
            onPress={onMarkPaid}
          >
            Mark as paid
          </Button>
          {!hasReview ? (
            <Button
              mode="outlined" style={[styles.primaryBtn, { borderColor: palette.primary }]} contentStyle={styles.barBtnContent} labelStyle={styles.btnLabel}
              icon="star-outline" textColor={palette.primary}
              disabled={busy || reviewRating < 1}
              onPress={onSubmitReview}
            >
              {reviewRating > 0 ? 'Submit review' : 'Tap a star above to rate'}
            </Button>
          ) : (
            <Button
              mode="outlined" style={[styles.primaryBtn, { borderColor: palette.primary }]} contentStyle={styles.barBtnContent} labelStyle={styles.btnLabel}
              icon="refresh-outline" textColor={palette.primary}
              onPress={onBookAgain}
            >
              Book again
            </Button>
          )}
        </>
      );
    } else if (!hasReview) {
      content = (
        <Button
          mode="contained" style={styles.primaryBtn} contentStyle={styles.barBtnContent} labelStyle={styles.btnLabel}
          icon="star-outline"
          loading={busy} disabled={busy || reviewRating < 1}
          onPress={onSubmitReview}
        >
          {reviewRating > 0 ? 'Submit review' : 'Tap a star above to rate'}
        </Button>
      );
    } else {
      content = (
        <Button
          mode="contained" style={styles.primaryBtn} contentStyle={styles.barBtnContent} labelStyle={styles.btnLabel}
          icon="refresh-outline"
          onPress={onBookAgain}
        >
          Book again
        </Button>
      );
    }
  } else if (TERMINAL.includes(status)) {
    content = (
      <PassiveNote
        icon="information-circle-outline"
        text={`This booking is ${STATUS_META[status].label.toLowerCase()}.`}
      />
    );
  }

  if (!content) return null;
  return (
    <View style={[styles.actionBar, { paddingBottom: insetBottom + spacing.sm }]}>
      {content}
    </View>
  );
}

function PassiveNote({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.passive}>
      <Ionicons name={icon} size={16} color={palette.textSecondary} />
      <Text style={styles.passiveText}>{text}</Text>
    </View>
  );
}

function LineItem({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.lineItem}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>ZMW {value.toFixed(2)}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.sm,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: r.sm },
  headerTitle: { ...typography.label, color: palette.textPrimary, fontSize: 16 },

  skeletons: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.sm },
  skelSm: { height: 48, borderRadius: r.sm },
  skelMd: { height: 90, borderRadius: r.sm },
  skelLg: { height: 150, borderRadius: r.sm },

  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },

  title: { ...typography.heading2, color: palette.textPrimary, marginBottom: spacing.sm },
  pill: { alignSelf: 'flex-start', borderRadius: r.sm, paddingHorizontal: spacing.md, paddingVertical: 5, marginBottom: spacing.lg },
  pillText: { ...typography.label, fontSize: 13 },

  // Stepper
  stepper: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  stepNode: { alignItems: 'center', width: 84 },
  stepCircle: {
    width: 28, height: 28, borderRadius: r.full,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: palette.border, backgroundColor: palette.surface,
  },
  stepCircleDone:    { backgroundColor: palette.success, borderColor: palette.success },
  stepCircleCurrent: { borderColor: palette.primary,     backgroundColor: palette.primaryLight },
  stepNum:           { ...typography.label, fontSize: 13, color: palette.textDisabled },
  stepNumCurrent:    { color: palette.primary },
  stepLabel:         { ...typography.bodySmall, color: palette.textDisabled, fontSize: 12, marginTop: 4, textAlign: 'center' },
  stepLabelActive:   { color: palette.textPrimary },
  stepConnector:     { flex: 1, height: 2, backgroundColor: palette.border, marginTop: -18 },
  stepConnectorDone: { backgroundColor: palette.success },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.lg },

  sectionLabel: { ...typography.label, color: palette.textPrimary, marginBottom: spacing.sm },

  // Provider
  providerRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar:         { width: 52, height: 52, borderRadius: r.full },
  avatarFallback: { width: 52, height: 52, borderRadius: r.full, backgroundColor: palette.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { ...typography.label, color: palette.primary, fontSize: 18 },
  providerInfo:   { flex: 1 },
  providerName:   { ...typography.body, color: palette.textPrimary, fontSize: 16, fontFamily: 'DMSans_500Medium' },
  providerMeta:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 3 },
  ratingChip:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText:     { ...typography.bodySmall, color: palette.textPrimary, fontSize: 13 },
  reviewCount:    { ...typography.bodySmall, color: palette.textSecondary, fontSize: 13 },
  tierChip: {
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: r.sm, backgroundColor: palette.primaryLight,
  },
  tierText: { ...typography.bodySmall, color: palette.primary, fontSize: 12 },

  // Momo block
  momoBlock: {
    marginTop: spacing.md,
    backgroundColor: palette.primaryLight,
    borderRadius: r.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  momoTopRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  momoHead:       { ...typography.label, color: palette.primary, fontSize: 14 },
  momoNumberRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  momoNetworkChip: {
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: r.sm, backgroundColor: palette.surface,
  },
  momoNetworkText: { ...typography.label, color: palette.textSecondary, fontSize: 12 },
  momoNumber: { ...typography.body, color: palette.textPrimary, fontFamily: 'DMSans_500Medium', fontSize: 16, flex: 1 },
  copyBtn:    { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: r.sm },
  momoPartialNote: { ...typography.bodySmall, color: palette.primary, fontSize: 13 },
  settledRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  settledText:  { ...typography.bodySmall, color: palette.success, fontSize: 13 },

  // Payment
  lineItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  lineLabel: { ...typography.body, color: palette.textPrimary, fontSize: 15, flex: 1 },
  lineValue: { ...typography.body, color: palette.textPrimary, fontSize: 15, fontFamily: 'DMSans_500Medium' },
  quoteNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 4 },
  quoteNoteText: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 14, flex: 1, lineHeight: 20 },
  paymentMode: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 13, marginTop: 4 },

  // Schedule
  iconLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 3 },
  iconLineText: { ...typography.body, color: palette.textPrimary, fontSize: 15, flex: 1 },
  autoConfirmNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  autoConfirmText: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 13 },

  // Notes
  notesText: { ...typography.body, color: palette.textPrimary, fontSize: 15, lineHeight: 22 },

  // Review
  reviewSub:   { ...typography.bodySmall, color: palette.textSecondary, marginBottom: spacing.md },
  starRow:     { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.md },
  starBtn:     { padding: spacing.xs, borderRadius: r.full },
  reviewedNote:{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reviewedText:{ ...typography.bodySmall, color: palette.success, fontSize: 14 },
  textArea: {
    ...typography.body, color: palette.textPrimary,
    borderWidth: 1, borderColor: palette.border, borderRadius: r.sm,
    padding: spacing.sm, minHeight: 96, textAlignVertical: 'top', marginTop: spacing.xs,
  },

  // Chips (dispute / safety)
  chipScroll: { marginBottom: spacing.xs },
  chipRow:    { flexDirection: 'row', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: r.sm, borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  chipDanger:       { backgroundColor: palette.danger, borderColor: palette.danger },
  chipText:         { ...typography.bodySmall, color: palette.textSecondary, fontSize: 13 },
  chipTextActive:   { color: '#fff' },

  formActions:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  formBtn:        { borderRadius: r.sm },
  formBtnContent: { height: 46 },

  // TOS
  tosRow:   { paddingVertical: spacing.sm },
  tosInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tosText:  { ...typography.bodySmall, color: palette.textSecondary, flex: 1 },

  // Safety form
  safetyForm: { gap: spacing.xs },

  // Report row
  reportRow:   { borderRadius: r.sm },
  reportInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  reportText:  { ...typography.body, color: palette.danger, fontSize: 15, flex: 1 },

  // Action bar
  actionBar: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border,
    backgroundColor: palette.surface,
    gap: spacing.sm,
  },
  primaryBtn:     { borderRadius: r.sm },
  barBtnContent:  { height: 50 },
  btnLabel:       { ...typography.label, fontSize: 15 },
  cancelBtn:      { borderRadius: r.sm, borderColor: palette.danger },
  emergencyRow:   { flexDirection: 'row', gap: spacing.sm },
  emergencyBtn:   { flex: 1, borderRadius: r.sm, borderColor: palette.danger },
  messageBtn:     { flex: 1, borderRadius: r.sm, borderColor: palette.primary },
  passive:        { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  passiveText:    { ...typography.bodySmall, color: palette.textSecondary, flex: 1, fontSize: 14 },
});
