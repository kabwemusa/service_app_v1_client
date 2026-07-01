import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Button, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bookingsApi } from '../../api/bookings';
import { ServiceAddon } from '../../api/services';
import { DURATION_OPTIONS, HOUR_OPTIONS, isHourPast, useBookingFlow } from '../../hooks/useBookingFlow';
import { DeliveryLocation } from '../../store/locationStore';
import { LocationPickerSheet } from '../location/LocationPickerSheet';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';
import { fontFamily } from '../../theme/typography';

// ── Availability helpers ──────────────────────────────────────────────────────

type AvailMatrix = Record<string, { start: string; end: string }[]>;
const DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

function isDayAvailable(day: Date, matrix: AvailMatrix | null | undefined): boolean {
  // Null / empty matrix = provider hasn't set restrictions → all days open.
  if (!matrix || Object.keys(matrix).length === 0) return true;
  const key   = DAY_KEYS[day.getDay()];
  const slots = matrix[key];
  return Array.isArray(slots) && slots.length > 0;
}

function isHourAvailable(hour: number, day: Date, matrix: AvailMatrix | null | undefined): boolean {
  if (!matrix || Object.keys(matrix).length === 0) return true;
  const key   = DAY_KEYS[day.getDay()];
  const slots = matrix[key];
  if (!Array.isArray(slots) || slots.length === 0) return false;
  return slots.some((slot) => {
    const startH = parseInt(slot.start.split(':')[0], 10);
    const endH   = parseInt(slot.end.split(':')[0], 10);
    return hour >= startH && hour < endH;
  });
}

// Relative day label — Today / Tomorrow, else weekday + date (§ booking workflow).
function dayChipLabel(day: Date): { top: string; bottom: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return { top: 'Today',    bottom: `${day.getDate()}` };
  if (diff === 1) return { top: 'Tomorrow', bottom: `${day.getDate()}` };
  return {
    top:    day.toLocaleDateString('en', { weekday: 'short' }),
    bottom: `${day.getDate()}`,
  };
}

function deliveryToSelected(dl: DeliveryLocation) {
  return {
    label:  dl.label,
    lat:    dl.lat,
    lng:    dl.lng,
    region: dl.region,
    source: (dl.source === 'DEVICE' ? 'DEVICE' : 'SEARCH') as 'DEVICE' | 'SEARCH',
  };
}

const CAT_PALETTE = [
  '#0891B2', '#2563EB', '#7C3AED', '#D97706',
  '#DB2777', '#16A34A', '#4B5563', '#0369A1',
  '#15803D', '#B45309', '#1D4ED8', '#1E40AF',
  '#92400E', '#9D174D',
];

// ── Sheet constants ───────────────────────────────────────────────────────────

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_H      = Math.min(SCREEN_H * 0.9, 760);
const DISMISS_Y    = 100;
const DISMISS_VEL  = 0.5;
const SPRING_OPEN  = { damping: 24, stiffness: 280 } as const;
const SPRING_CLOSE = { damping: 20, stiffness: 260 } as const;

interface Props {
  visible:         boolean;
  onClose:         () => void;
  serviceId:       string;
  serviceTitle:    string;
  basePrice:       number;
  pricingModel?:   'FIXED' | 'HOURLY' | 'QUOTE';
  // Platform payment mode — drives total breakdown + CTA copy (DIRECT = no escrow, no 2% fee).
  paymentMode?:    'DIRECT' | 'ESCROW';
  // Provider availability: keys are SUN/MON/…/SAT, values are [{start, end}] windows.
  availabilityMatrix?: AvailMatrix | null;

  // ── Summary (optional — degrades gracefully when omitted) ──
  thumbUri?:           string | null;
  categoryId?:         number | null;
  categoryIcon?:       string | null;
  providerName?:       string | null;
  durationMins?:       number | null;

  // Service add-ons (§5.3) rendered as toggles that update the live total.
  addons?:         ServiceAddon[];
  // Pre-selected add-ons (e.g. chosen on the service detail screen) — initial state.
  selectedAddons?: { id: number; name: string; price: number }[];
  onBooked:        (bookingId: string) => void;
}

export function BookingSheet({
  visible, onClose, serviceId, serviceTitle, basePrice,
  pricingModel = 'FIXED', paymentMode = 'ESCROW', availabilityMatrix,
  thumbUri, categoryId, categoryIcon, providerName, durationMins,
  addons, selectedAddons = [], onBooked,
}: Props) {
  const insets          = useSafeAreaInsets();
  const translateY      = useSharedValue(SHEET_H);
  const backdropOpacity = useSharedValue(0);
  const flow            = useBookingFlow(serviceId);

  const avail   = availabilityMatrix ?? null;
  const isDirect = paymentMode === 'DIRECT';
  const isQuote  = pricingModel === 'QUOTE';

  // Add-on list to render as toggles; falls back to the pre-selected list for
  // callers that don't pass the full catalogue.
  const addonList: ServiceAddon[] = addons ?? selectedAddons;
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [notes,       setNotes]       = useState('');
  const [pickerOpen,  setPickerOpen]  = useState(false);

  // Booked hours: set of "dateString-hour" keys greyed out as already taken.
  const [bookedHours, setBookedHours] = useState<Set<string>>(new Set());

  // A day is selectable if the provider works that day AND at least one
  // hour remains available (not past + not outside the provider window).
  function isDaySelectable(day: Date): boolean {
    if (!isDayAvailable(day, avail)) return false;
    return HOUR_OPTIONS.some((h) =>
      isHourAvailable(h, day, avail) && !isHourPast(h, day),
    );
  }

  const firstAvailableDay = useMemo(
    () => flow.days.find((d) => isDaySelectable(d)) ?? flow.days[0],
    [flow.days, avail],
  );

  const close = useCallback(() => {
    translateY.value      = withSpring(SHEET_H, SPRING_CLOSE);
    backdropOpacity.value = withTiming(0, { duration: 200 }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }, [onClose]);

  // Open: animate in, reset to first available day + the pre-selected add-ons.
  // Fetch booked slots so taken hours are greyed out.
  useEffect(() => {
    if (visible) {
      translateY.value      = withSpring(0, SPRING_OPEN);
      backdropOpacity.value = withTiming(0.55, { duration: 250 });
      flow.reset(firstAvailableDay);
      setSelectedIds(new Set(selectedAddons.map((a) => a.id)));
      setNotes('');
      setBookedHours(new Set());

      bookingsApi.bookedSlots(serviceId).then(({ slots }) => {
        const keys = new Set<string>();
        for (const slot of slots) {
          const start = new Date(slot.start);
          const end   = new Date(slot.end);
          // Mark each whole hour touched by [start, end) as booked
          const cur = new Date(start);
          cur.setMinutes(0, 0, 0);
          while (cur < end) {
            keys.add(`${cur.toDateString()}-${cur.getHours()}`);
            cur.setHours(cur.getHours() + 1);
          }
        }
        setBookedHours(keys);
      }).catch(() => {});
    }
  }, [visible]);

  // When the day changes, ensure the selected hour is valid (in window + not past).
  useEffect(() => {
    const current = flow.startHour;
    const isValid = isHourAvailable(current, flow.selectedDay, avail)
                 && !isHourPast(current, flow.selectedDay)
                 && !bookedHours.has(`${flow.selectedDay.toDateString()}-${current}`);
    if (!isValid) {
      const firstHour = HOUR_OPTIONS.find((h) =>
        isHourAvailable(h, flow.selectedDay, avail) && !isHourPast(h, flow.selectedDay)
        && !bookedHours.has(`${flow.selectedDay.toDateString()}-${h}`),
      );
      if (firstHour !== undefined) flow.setStartHour(firstHour);
    }
  }, [flow.selectedDay, bookedHours]);

  // Drag-to-dismiss via PanResponder on the handle area
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  (_, g) => g.dy > 4,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.value = g.dy;
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_Y || g.vy > DISMISS_VEL) close();
        else translateY.value = withSpring(0, SPRING_OPEN);
      },
    }),
  ).current;

  const sheetStyle    = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  // ── Totals ──────────────────────────────────────────────────────────────────
  const svcCost  = pricingModel === 'HOURLY' ? basePrice * flow.durationHrs : basePrice;
  const addonSum = addonList.filter((a) => selectedIds.has(a.id)).reduce((s, a) => s + a.price, 0);
  // No buyer-protection fee in DIRECT mode — there is no escrow to back it.
  const prot     = !isDirect && !isQuote ? Math.min((svcCost + addonSum) * 0.02, 50) : 0;
  const total    = svcCost + addonSum + prot;

  const catColor = CAT_PALETTE[(categoryId ?? 0) % CAT_PALETTE.length];

  const toggleAddon = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  async function handleConfirm() {
    const booking = await flow.submit(Array.from(selectedIds), isQuote ? notes : undefined);
    if (booking) {
      // ESCROW (fixed-price): kick off the mobile-money collection immediately so the
      // customer gets the USSD prompt. The gateway callback advances REQUESTED →
      // PENDING_PAYMENT → FUNDS_HELD. If the push can't be initiated the booking stays
      // REQUESTED and the customer can retry "Pay & hold funds" from the booking detail.
      if (!isDirect && !isQuote) {
        try { await bookingsApi.pay(booking.id); } catch { /* retry available on booking detail */ }
      }
      close();
      onBooked(booking.id);
    }
  }

  const ctaLabel = isQuote
    ? 'Request quote'
    : isDirect
    ? 'Request booking'
    : `Confirm booking · ZMW ${total.toFixed(0)}`;

  const durationLabel = durationMins
    ? durationMins >= 60
      ? `~${Math.round((durationMins / 60) * 10) / 10} hr`
      : `~${durationMins} min`
    : null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={styles.root}>
        {/* ── Dimmed backdrop ─────────────────────────────────── */}
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Dismiss" />
        </Animated.View>

        {/* ── Sheet ───────────────────────────────────────────── */}
        <KeyboardAvoidingView
          style={styles.kavWrapper}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Animated.View
            style={[styles.sheet, sheetStyle, { maxHeight: SHEET_H }]}
            accessibilityViewIsModal
            accessibilityLabel={`Book ${serviceTitle}`}
          >
            {/* Drag handle */}
            <View style={styles.handleArea} {...panResponder.panHandlers}>
              <View style={styles.handle} />
            </View>

            {/* ── Service summary: thumb + title + provider + duration ── */}
            <View style={styles.header}>
              <View style={styles.summaryThumbWrap}>
                {thumbUri ? (
                  <Image source={{ uri: thumbUri }} style={styles.summaryThumb} contentFit="cover" transition={120} />
                ) : (
                  <View style={[styles.summaryThumb, { backgroundColor: `${catColor}18` }]}>
                    <Ionicons
                      name={(categoryIcon ?? 'grid-outline') as any}
                      size={20}
                      color={catColor}
                    />
                  </View>
                )}
              </View>
              <View style={styles.headerLeft}>
                <Text style={styles.headerTitle} numberOfLines={1}>{serviceTitle}</Text>
                <Text style={styles.headerMeta} numberOfLines={1}>
                  {[providerName, durationLabel].filter(Boolean).join('  ·  ') || 'Choose a time & place'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={close}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={18} color={palette.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Scrollable form */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
            >
              {/* ── When: date ─────────────────────────────────── */}
              <Text style={styles.sLabel}>When</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
                accessibilityRole="radiogroup"
              >
                {flow.days.map((day, i) => {
                  const active    = day.toDateString() === flow.selectedDay.toDateString();
                  const available = isDaySelectable(day);
                  const lbl       = dayChipLabel(day);
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.dayChip, active && styles.chipSel, !available && styles.chipUnavailable]}
                      onPress={() => available && flow.setSelectedDay(day)}
                      activeOpacity={available ? 0.7 : 1}
                      accessibilityRole="radio"
                      accessibilityLabel={
                        available
                          ? day.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' })
                          : `${day.toLocaleDateString('en', { weekday: 'long' })} — unavailable`
                      }
                      accessibilityState={{ disabled: !available, selected: active }}
                    >
                      <Text style={[styles.dayWkd, active && styles.chipTxtSel, !available && styles.txtUnavailable]}>
                        {lbl.top}
                      </Text>
                      <Text style={[styles.dayNum, active && styles.chipTxtSel, !available && styles.txtUnavailable]}>
                        {lbl.bottom}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* ── When: start time ───────────────────────────── */}
              <Text style={styles.sLabel}>Start time</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
                accessibilityRole="radiogroup"
              >
                {HOUR_OPTIONS.map((h) => {
                  const active    = h === flow.startHour;
                  const past      = isHourPast(h, flow.selectedDay);
                  const inMatrix  = isHourAvailable(h, flow.selectedDay, avail);
                  const booked    = bookedHours.has(`${flow.selectedDay.toDateString()}-${h}`);
                  const available = inMatrix && !past && !booked;
                  return (
                    <TouchableOpacity
                      key={h}
                      style={[styles.timeChip, active && styles.chipSel, !available && styles.chipUnavailable]}
                      onPress={() => available && flow.setStartHour(h)}
                      activeOpacity={available ? 0.7 : 1}
                      accessibilityRole="radio"
                      accessibilityState={{ disabled: !available, selected: active }}
                      accessibilityLabel={
                        `${h.toString().padStart(2, '0')}:00` +
                        (past ? ', already passed' : booked ? ', already booked' : !inMatrix ? ', unavailable' : '')
                      }
                    >
                      <Text style={[styles.timeChipTxt, active && styles.chipTxtSel, !available && styles.txtUnavailable]}>
                        {h.toString().padStart(2, '0')}:00
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* ── Duration ───────────────────────────────────── */}
              <Text style={styles.sLabel}>Duration</Text>
              <View style={styles.durationRow}>
                {DURATION_OPTIONS.map((d) => {
                  const active = d === flow.durationHrs;
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[styles.durChip, active && styles.durChipSel]}
                      onPress={() => flow.setDurationHrs(d)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.durTxt, active && styles.durTxtSel]}>
                        {d === 1 ? '1 hr' : `${d} hrs`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ── Where: active delivery location + Change ───── */}
              <Text style={styles.sLabel}>Where</Text>
              <TouchableOpacity
                style={styles.locationRow}
                onPress={() => setPickerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={
                  flow.deliveryLocation
                    ? `Delivery location ${flow.deliveryLocation.label}. Tap to change`
                    : 'Add a delivery location'
                }
              >
                <Ionicons name="location-outline" size={16} color={palette.primary} />
                <Text
                  style={[styles.locationTxt, !flow.deliveryLocation && styles.locationTxtEmpty]}
                  numberOfLines={1}
                >
                  {flow.deliveryLocation?.label ?? 'Add a delivery location'}
                </Text>
                <Text style={styles.locationChange}>
                  {flow.deliveryLocation ? 'Change' : 'Add'}
                </Text>
              </TouchableOpacity>

              {/* ── Add extras: add-on toggles ─────────────────── */}
              {addonList.length > 0 && (
                <>
                  <Text style={styles.sLabel}>Add extras</Text>
                  <View style={styles.addonCard}>
                    {addonList.map((addon, idx) => {
                      const on = selectedIds.has(addon.id);
                      return (
                        <TouchableOpacity
                          key={addon.id}
                          style={[styles.addonRow, idx > 0 && styles.addonDivider]}
                          onPress={() => toggleAddon(addon.id)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={`${addon.name}, ZMW ${addon.price.toFixed(0)}`}
                        >
                          <View style={[styles.checkbox, on && styles.checkboxOn]}>
                            {on && <Ionicons name="checkmark" size={13} color="#fff" />}
                          </View>
                          <Text style={styles.addonName} numberOfLines={1}>{addon.name}</Text>
                          <Text style={styles.addonPrice}>+ ZMW {addon.price.toFixed(0)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* ── Notes (QUOTE only) ─────────────────────────── */}
              {isQuote && (
                <>
                  <Text style={styles.sLabel}>Anything the provider should know?</Text>
                  <TextInput
                    style={styles.notesInput}
                    placeholder="Describe what you need (optional)…"
                    placeholderTextColor={palette.textDisabled}
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    accessibilityLabel="Notes for the provider"
                  />
                </>
              )}

              {/* ── Total + DIRECT note ────────────────────────── */}
              <View style={styles.totalCard}>
                {isQuote ? (
                  <View style={styles.quoteNote}>
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color={palette.textSecondary} />
                    <Text style={styles.quoteNoteTxt}>
                      No fixed price yet — you’ll agree a price with{' '}
                      {providerName ?? 'the provider'} after they review your request.
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.feeRow}>
                      <Text style={styles.feeLbl}>Service{pricingModel === 'HOURLY' ? ` (${flow.durationHrs} hr${flow.durationHrs > 1 ? 's' : ''})` : ''}</Text>
                      <Text style={styles.feeAmt}>ZMW {svcCost.toFixed(0)}</Text>
                    </View>
                    {addonList.filter((a) => selectedIds.has(a.id)).map((addon) => (
                      <View key={addon.id} style={styles.feeRow}>
                        <Text style={styles.feeLbl} numberOfLines={1}>{addon.name}</Text>
                        <Text style={styles.feeAmt}>ZMW {addon.price.toFixed(0)}</Text>
                      </View>
                    ))}
                    {!isDirect && (
                      <View style={styles.feeRow}>
                        <Text style={styles.feeLbl}>Buyer protection (2%)</Text>
                        <Text style={styles.feeAmt}>ZMW {prot.toFixed(0)}</Text>
                      </View>
                    )}
                    <View style={styles.feeDivider} />
                    <View
                      style={styles.feeRow}
                      accessibilityLiveRegion="polite"
                      accessibilityLabel={`Total ${total.toFixed(0)} kwacha`}
                    >
                      <Text style={styles.feeTotalLbl}>{isDirect ? 'Agreed price' : 'Total'}</Text>
                      <Text style={styles.feeTotalAmt}>ZMW {total.toFixed(0)}</Text>
                    </View>
                  </>
                )}

                <View style={styles.modeBanner}>
                  <Ionicons
                    name={isDirect ? 'cash-outline' : 'lock-closed-outline'}
                    size={14}
                    color={palette.success}
                  />
                  <Text style={styles.modeNote}>
                    {isDirect
                      ? `You'll pay ${providerName ?? 'the provider'} directly after the job · they'll confirm your request.`
                      : 'Held securely in escrow — released to the provider only when you confirm the job is complete.'}
                  </Text>
                </View>

                <Button
                  mode="contained"
                  style={styles.cta}
                  contentStyle={styles.ctaContent}
                  labelStyle={styles.ctaLabel}
                  onPress={handleConfirm}
                  loading={flow.submitting}
                  disabled={!flow.canSubmit}
                >
                  {ctaLabel}
                </Button>
              </View>
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>

        {/* Location picker — §4, label-only, opened by Change */}
        <LocationPickerSheet
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(dl) => flow.setDeliveryLocation(deliveryToSelected(dl))}
          title="Delivery location"
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F172A',
  },
  kavWrapper: { justifyContent: 'flex-end' },

  sheet: {
    backgroundColor:      palette.surface,
    borderTopLeftRadius:  r.xl,
    borderTopRightRadius: r.xl,
    ...shadow.modal,
  },

  handleArea: {
    alignItems:    'center',
    paddingTop:    spacing.sm,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xl,
  },
  handle: {
    width:           36,
    height:          4,
    backgroundColor: palette.border,
    borderRadius:    r.full,
  },

  // Summary header
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical:   spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  summaryThumbWrap: { width: 44, height: 44 },
  summaryThumb: {
    width:          44,
    height:         44,
    borderRadius:   r.sm,
    alignItems:     'center',
    justifyContent: 'center',
    overflow:       'hidden',
  },
  headerLeft:  { flex: 1 },
  headerTitle: { ...typography.label, color: palette.textPrimary, fontSize: 16 },
  headerMeta:  { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12, marginTop: 2 },
  closeBtn: {
    width:           32,
    height:          32,
    borderRadius:    r.full,
    backgroundColor: palette.background,
    alignItems:      'center',
    justifyContent:  'center',
  },

  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  sLabel: {
    ...typography.label,
    color:        palette.textSecondary,
    fontSize:     13,
    marginBottom: spacing.xs,
    marginTop:    spacing.md,
  },

  chipRow:    { gap: spacing.xs, paddingBottom: spacing.xs },
  chipSel:    { backgroundColor: palette.primary, borderColor: palette.primary },
  chipTxtSel: { color: '#fff' },
  chipUnavailable: { backgroundColor: palette.skeleton, borderColor: palette.border, opacity: 0.55 },
  txtUnavailable:  { color: palette.textDisabled, textDecorationLine: 'line-through' },

  dayChip: {
    width:           54,
    paddingVertical: spacing.sm,
    borderRadius:    r.sm,
    borderWidth:     1,
    borderColor:     palette.border,
    backgroundColor: palette.background,
    alignItems:      'center',
  },
  dayWkd: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 11 },
  dayNum: { ...typography.label,     color: palette.textPrimary,   fontSize: 16 },

  timeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    borderRadius:      r.sm,
    borderWidth:       1,
    borderColor:       palette.border,
    backgroundColor:   palette.background,
  },
  timeChipTxt: { ...typography.bodySmall, color: palette.textPrimary },

  durationRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  durChip: {
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    borderRadius:      r.sm,
    borderWidth:       1,
    borderColor:       palette.border,
    backgroundColor:   palette.background,
  },
  durChipSel: { backgroundColor: palette.primaryLight, borderColor: palette.primary },
  durTxt:     { ...typography.bodySmall, color: palette.textPrimary },
  durTxtSel:  { ...typography.bodySmall, color: palette.primary },

  // Location row
  locationRow: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing.sm,
    backgroundColor: palette.background,
    borderRadius:    r.sm,
    borderWidth:     1,
    borderColor:     palette.border,
    paddingHorizontal: spacing.md,
    minHeight:       48,
  },
  locationTxt:      { ...typography.bodySmall, color: palette.textPrimary, flex: 1 },
  locationTxtEmpty: { color: palette.textSecondary },
  locationChange:   { ...typography.label, color: palette.primary, fontSize: 13 },

  // Add-on toggles
  addonCard: {
    backgroundColor: palette.background,
    borderRadius:    r.sm,
    borderWidth:     1,
    borderColor:     palette.border,
    overflow:        'hidden',
  },
  addonRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm + 2,
    minHeight:         48,
  },
  addonDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  checkbox: {
    width:           20,
    height:          20,
    borderRadius:    6,
    borderWidth:     1.5,
    borderColor:     palette.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  checkboxOn:  { backgroundColor: palette.primary, borderColor: palette.primary },
  addonName:   { ...typography.bodySmall, color: palette.textPrimary, flex: 1 },
  addonPrice:  { ...typography.bodySmall, color: palette.textSecondary },

  // Notes
  notesInput: {
    backgroundColor: palette.background,
    borderRadius:    r.sm,
    borderWidth:     1,
    borderColor:     palette.border,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    minHeight:       72,
    textAlignVertical: 'top',
    fontFamily:      fontFamily.regular,
    fontSize:        14,
    color:           palette.textPrimary,
  },

  // Total
  totalCard: {
    marginTop:       spacing.lg,
    backgroundColor: palette.background,
    borderRadius:    r.md,
    borderWidth:     1,
    borderColor:     palette.border,
    padding:         spacing.md,
    gap:             spacing.sm,
  },
  feeRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feeLbl:      { ...typography.bodySmall, color: palette.textSecondary, flex: 1, marginRight: spacing.sm },
  feeAmt:      { ...typography.bodySmall, color: palette.textPrimary },
  feeDivider:  { height: 1, backgroundColor: palette.border, marginVertical: 2 },
  feeTotalLbl: { ...typography.label, color: palette.textPrimary },
  feeTotalAmt: { fontFamily: fontFamily.bold, fontSize: 16, color: palette.primary },

  quoteNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  quoteNoteTxt: { ...typography.bodySmall, color: palette.textSecondary, flex: 1, lineHeight: 18 },

  modeBanner: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    gap:             spacing.xs,
    backgroundColor: palette.successLight,
    borderRadius:    r.sm,
    padding:         spacing.sm,
  },
  modeNote: { ...typography.bodySmall, color: palette.success, flex: 1, lineHeight: 17 },

  cta:        { borderRadius: r.md, marginTop: spacing.xs },
  ctaContent: { height: 52 },
  ctaLabel:   { ...typography.label, fontSize: 15, letterSpacing: 0.2 },
});
