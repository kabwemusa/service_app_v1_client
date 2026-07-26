import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
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
import { PricingModel, ServiceAddon } from '../../api/services';
import { HOUR_OPTIONS, isHourPast, PickedScopeMedia, useBookingFlow } from '../../hooks/useBookingFlow';
import { useSnackbar } from '../../providers/SnackbarProvider';
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

// Relative day label — "Today", otherwise the weekday + date.
function dayChipLabel(day: Date): { top: string; bottom: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return { top: 'Today', bottom: `${day.getDate()}` };
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
  // Outcome-based pricing — customers never input hours anywhere in this sheet.
  pricingModel?:   PricingModel;
  // HOURLY_CAPPED parameters (provider-set)
  hourlyRate?:     number | null;
  minimumHours?:   number | null;
  capHours?:       number | null;
  capAmount?:      number | null;
  // QUOTE_DEPOSIT
  depositPercent?: number | null;
  // Structured brief questions (PROVIDER_SCOPE / QUOTE_DEPOSIT)
  scopePrompts?:   string[];
  // Platform payment mode — drives total breakdown + CTA copy (DIRECT = no escrow, no 2% fee).
  paymentMode?:    'DIRECT' | 'ESCROW';
  // Delivered online (tutoring, design, consulting) — nationwide, no location
  // needed. The customer picks a delivery location only for IN_PERSON services;
  // for REMOTE the sheet shows a static "Delivered online" row instead.
  isRemote?:       boolean;
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

const DEFAULT_BRIEF_PROMPTS = [
  'What exactly needs doing?',
  'How big is the job? (rooms, items, or size)',
  'Any special conditions the provider should know about?',
];

// A little under the backend's cap (8 total, 1 video) — headroom for rounding.
const MAX_SCOPE_PHOTOS = 6;
const MAX_SCOPE_VIDEOS = 1;

export function BookingSheet({
  visible, onClose, serviceId, serviceTitle, basePrice,
  pricingModel = 'OUTCOME_FIXED', paymentMode = 'ESCROW', isRemote = false, availabilityMatrix,
  hourlyRate, minimumHours, capHours, capAmount, depositPercent, scopePrompts,
  thumbUri, categoryId, categoryIcon, providerName, durationMins,
  addons, selectedAddons = [], onBooked,
}: Props) {
  const insets          = useSafeAreaInsets();
  const translateY      = useSharedValue(SHEET_H);
  const backdropOpacity = useSharedValue(0);
  const flow            = useBookingFlow(serviceId, isRemote);

  const avail   = availabilityMatrix ?? null;
  const isDirect = paymentMode === 'DIRECT';
  // Quote-first models: structured brief → provider quote → approval → escrow.
  const isQuote  = pricingModel === 'PROVIDER_SCOPE' || pricingModel === 'QUOTE_DEPOSIT';
  const isCapped = pricingModel === 'HOURLY_CAPPED';

  const briefPrompts = isQuote
    ? (scopePrompts && scopePrompts.length ? scopePrompts : DEFAULT_BRIEF_PROMPTS)
    : [];
  const [briefAnswers, setBriefAnswers] = useState<string[]>([]);

  // Photos / a short video attached to the brief (quote-first models only) —
  // uploaded right after the booking is created (see handleConfirm). Capped
  // client-side a little under the server's limit (8 total, 1 video).
  const [scopeMedia, setScopeMedia] = useState<PickedScopeMedia[]>([]);
  const { showError, showSnackbar } = useSnackbar();
  const photoCount = scopeMedia.filter((m) => !m.mimeType.startsWith('video/')).length;
  const videoCount = scopeMedia.filter((m) => m.mimeType.startsWith('video/')).length;

  // Add-on list to render as toggles; falls back to the pre-selected list for
  // callers that don't pass the full catalogue.
  const addonList: ServiceAddon[] = addons ?? selectedAddons;
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [notes,       setNotes]       = useState('');
  const [promoCode,   setPromoCode]   = useState('');
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
      setScopeMedia([]);
      setNotes('');
      setBriefAnswers(briefPrompts.map(() => ''));
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
  // HOURLY_CAPPED: the amount held is the SPEND CAP (provider-set) — the
  // customer never chooses hours; actual time is charged and the rest refunded.
  const svcCost  = isCapped
    ? (capAmount ?? (hourlyRate && capHours ? hourlyRate * capHours : basePrice))
    : basePrice;
  const addonSum = addonList.filter((a) => selectedIds.has(a.id)).reduce((s, a) => s + a.price, 0);
  // No buyer-protection fee in DIRECT mode — there is no escrow to back it.
  const prot     = !isDirect && !isQuote ? Math.min((svcCost + addonSum) * 0.02, 50) : 0;
  const total    = svcCost + addonSum + prot;

  const briefComplete = !isQuote || briefAnswers.every((a) => a.trim().length > 0);

  const catColor = CAT_PALETTE[(categoryId ?? 0) % CAT_PALETTE.length];

  const toggleAddon = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Brief media (quote-first models): photos + a short video ────────────
  // Fresh capture (camera) covers "take a photo of the problem"; the gallery
  // picker covers "I already snapped this earlier".

  async function takeScopePhoto() {
    if (photoCount >= MAX_SCOPE_PHOTOS) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') { showError('Camera permission is required.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setScopeMedia((prev) => [...prev, {
      uri: asset.uri, name: `photo_${Date.now()}.jpg`, mimeType: 'image/jpeg',
    }]);
  }

  async function recordScopeVideo() {
    if (videoCount >= MAX_SCOPE_VIDEOS) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') { showError('Camera permission is required.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 60 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setScopeMedia((prev) => [...prev, {
      uri: asset.uri, name: `video_${Date.now()}.mp4`, mimeType: 'video/mp4',
    }]);
  }

  async function pickScopeMediaFromGallery() {
    const remainingPhotos = MAX_SCOPE_PHOTOS - photoCount;
    const remainingVideos = MAX_SCOPE_VIDEOS - videoCount;
    if (remainingPhotos <= 0 && remainingVideos <= 0) {
      showError(`You've reached the ${MAX_SCOPE_PHOTOS} photo / ${MAX_SCOPE_VIDEOS} video limit.`);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') { showError('Photo library permission is required.'); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: remainingPhotos + remainingVideos,
      quality: 0.7,
    });
    if (result.canceled) return;

    let addedPhotos = 0;
    let addedVideos = 0;
    let skipped = 0;
    const picked: PickedScopeMedia[] = [];
    for (const asset of result.assets) {
      const isVideo = asset.type === 'video';
      if (isVideo ? addedVideos >= remainingVideos : addedPhotos >= remainingPhotos) {
        skipped++;
        continue;
      }
      if (isVideo) addedVideos++; else addedPhotos++;
      picked.push({
        uri:      asset.uri,
        name:     asset.fileName ?? `${isVideo ? 'video' : 'photo'}_${Date.now()}_${picked.length}.${isVideo ? 'mp4' : 'jpg'}`,
        mimeType: asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
      });
    }
    if (skipped > 0) {
      showSnackbar({ message: `${skipped} item(s) skipped — limit reached.`, variant: 'info' });
    }
    setScopeMedia((prev) => [...prev, ...picked]);
  }

  function removeScopeMedia(index: number) {
    setScopeMedia((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleConfirm() {
    // Quote-first models submit the structured brief; nothing is charged here.
    const scopeBrief = isQuote
      ? briefPrompts.map((q, i) => ({ question: q, answer: briefAnswers[i]?.trim() ?? '' }))
      : undefined;

    const booking = await flow.submit(
      Array.from(selectedIds),
      isQuote && notes.trim() ? notes : undefined,
      scopeBrief,
      isQuote && scopeMedia.length ? scopeMedia : undefined,
    );
    if (booking) {
      // ESCROW (priced models): kick off the mobile-money collection immediately so the
      // customer gets the USSD prompt. The gateway callback advances REQUESTED →
      // PENDING_PAYMENT → FUNDS_HELD. If the push can't be initiated the booking stays
      // REQUESTED and the customer can retry "Pay & hold funds" from the booking detail.
      if (!isDirect && !isQuote) {
        // Any live checkout campaign auto-applies server-side; an entered promo
        // code is validated server-side too. The server computes + applies the
        // discount atomically with the hold (provider paid in full).
        const code = promoCode.trim() || undefined;
        try { await bookingsApi.pay(booking.id, undefined, code); } catch { /* retry available on booking detail */ }
      }
      close();
      onBooked(booking.id);
    }
  }

  // Keep the CTA to a plain action — the price breakdown sits directly above it.
  const ctaLabel = isQuote
    ? 'Get a quote'
    : isDirect
    ? 'Request booking'
    : `Pay ZMW ${total.toFixed(0)}`;

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

              {/* ── Duration guide (provider-set — never a customer input) ── */}
              {durationLabel && !isCapped && (
                <View style={styles.durationGuide}>
                  <Ionicons name="time-outline" size={14} color={palette.textSecondary} />
                  <Text style={styles.durationGuideTxt}>
                    Estimated duration: {durationLabel} — set by the provider as a guide.
                  </Text>
                </View>
              )}

              {/* ── HOURLY_CAPPED: rate / minimum / cap card ────── */}
              {isCapped && (
                <View style={styles.capCard}>
                  <Text style={styles.capHeadline}>
                    ZMW {(hourlyRate ?? 0).toFixed(0)}/hr · you only pay for the time worked
                  </Text>
                  <Text style={styles.capNote}>
                    The most you'd pay is ZMW {svcCost.toFixed(0)}. You're charged only for the
                    time actually worked.
                  </Text>
                </View>
              )}

              {/* ── Where: active delivery location + Change (IN_PERSON only) ── */}
              <Text style={styles.sLabel}>Where</Text>
              {isRemote ? (
                <View style={styles.locationRow} accessibilityLabel="Delivered online — no location needed">
                  <Ionicons name="globe-outline" size={16} color={palette.primary} />
                  <Text style={styles.locationTxt} numberOfLines={1}>
                    Delivered online — no location needed
                  </Text>
                </View>
              ) : (
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
              )}

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

              {/* ── Structured brief (quote-first models) ───────── */}
              {isQuote && (
                <>
                  <Text style={styles.sLabel}>Tell the provider about the job</Text>
                  {briefPrompts.map((question, i) => (
                    <View key={i} style={styles.briefField}>
                      <Text style={styles.briefQuestion}>{question}</Text>
                      <TextInput
                        style={styles.briefInput}
                        placeholder="Your answer…"
                        placeholderTextColor={palette.textDisabled}
                        value={briefAnswers[i] ?? ''}
                        onChangeText={(t) => setBriefAnswers((prev) => {
                          const next = [...prev];
                          next[i] = t;
                          return next;
                        })}
                        accessibilityLabel={question}
                      />
                    </View>
                  ))}
                  <Text style={styles.sLabel}>Anything else? (optional)</Text>
                  <TextInput
                    style={styles.notesInput}
                    placeholder="Extra details for the provider…"
                    placeholderTextColor={palette.textDisabled}
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    accessibilityLabel="Notes for the provider"
                  />

                  {/* ── Photos / short video — helps the provider price it ── */}
                  <Text style={styles.sLabel}>Add photos or a video (optional)</Text>
                  <Text style={styles.mediaHint}>
                    A photo of the problem (or a short video) helps the provider quote accurately.
                  </Text>

                  {scopeMedia.length > 0 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.mediaThumbRow}
                      contentContainerStyle={{ gap: spacing.sm }}
                    >
                      {scopeMedia.map((m, idx) => {
                        const isVideo = m.mimeType.startsWith('video/');
                        return (
                          <View key={`${m.uri}-${idx}`} style={styles.mediaThumb}>
                            <Image source={{ uri: m.uri }} style={styles.mediaThumbImg} contentFit="cover" />
                            {isVideo && (
                              <View style={styles.mediaThumbPlayBadge}>
                                <Ionicons name="play" size={12} color="#fff" />
                              </View>
                            )}
                            <TouchableOpacity
                              style={styles.mediaThumbRemove}
                              onPress={() => removeScopeMedia(idx)}
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${isVideo ? 'video' : 'photo'}`}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons name="close" size={12} color="#fff" />
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </ScrollView>
                  )}

                  <View style={styles.mediaActionsRow}>
                    <TouchableOpacity
                      style={[styles.mediaActionBtn, photoCount >= MAX_SCOPE_PHOTOS && styles.mediaActionBtnDisabled]}
                      onPress={takeScopePhoto}
                      disabled={photoCount >= MAX_SCOPE_PHOTOS}
                      accessibilityRole="button"
                      accessibilityLabel="Take a photo"
                    >
                      <Ionicons name="camera-outline" size={16} color={palette.primary} />
                      <Text style={styles.mediaActionTxt}>Take photo</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.mediaActionBtn, videoCount >= MAX_SCOPE_VIDEOS && styles.mediaActionBtnDisabled]}
                      onPress={recordScopeVideo}
                      disabled={videoCount >= MAX_SCOPE_VIDEOS}
                      accessibilityRole="button"
                      accessibilityLabel="Record a short video"
                    >
                      <Ionicons name="videocam-outline" size={16} color={palette.primary} />
                      <Text style={styles.mediaActionTxt}>Record video</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.mediaActionBtn}
                      onPress={pickScopeMediaFromGallery}
                      accessibilityRole="button"
                      accessibilityLabel="Choose from gallery"
                    >
                      <Ionicons name="images-outline" size={16} color={palette.primary} />
                      <Text style={styles.mediaActionTxt}>Gallery</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* ── Total + DIRECT note ────────────────────────── */}
              <View style={styles.totalCard}>
                {isQuote ? (
                  <View style={styles.quoteNote}>
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color={palette.textSecondary} />
                    <Text style={styles.quoteNoteTxt}>
                      {pricingModel === 'QUOTE_DEPOSIT'
                        ? `${providerName ?? 'The provider'} will send a full quote after reviewing your brief. `
                          + `A ${depositPercent ?? 30}% deposit confirms the booking — the balance is collected on completion. `
                          + 'Nothing is charged until you approve the quote.'
                        : `${providerName ?? 'The provider'} will review your brief and send a quote with the price, `
                          + "duration and what's included. Nothing is charged until you approve it."}
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.feeRow}>
                      <Text style={styles.feeLbl}>{isCapped ? 'Cost (up to)' : 'Service'}</Text>
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
                    {/* Growth & Promotions: optional promo code. Any live
                        offer also applies automatically; the discount is
                        computed server-side at payment and shown on your
                        booking. */}
                    {!isDirect && (
                      <View style={styles.promoRow}>
                        <Ionicons name="pricetag-outline" size={15} color={palette.textSecondary} />
                        <TextInput
                          style={styles.promoInput}
                          value={promoCode}
                          onChangeText={(t) => setPromoCode(t.toUpperCase())}
                          placeholder="Promo code (optional)"
                          placeholderTextColor={palette.textDisabled}
                          autoCapitalize="characters"
                          autoCorrect={false}
                          maxLength={40}
                          accessibilityLabel="Promo code"
                        />
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
                      : isCapped
                      ? "You pay only for the time worked. Your payment is held safely until you confirm the job's done."
                      : isQuote
                      ? "Once you approve the quote, your payment is held safely and released only when you confirm the job's done."
                      : "Your payment is held safely by our licensed partner — released to the provider only when you confirm the job's done."}
                  </Text>
                </View>

                <Button
                  mode="contained"
                  style={styles.cta}
                  contentStyle={styles.ctaContent}
                  labelStyle={styles.ctaLabel}
                  onPress={handleConfirm}
                  loading={flow.submitting}
                  disabled={!flow.canSubmit || !briefComplete}
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

  // Provider-set duration guide (customers never input hours)
  durationGuide: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing.xs,
    marginTop:     spacing.md,
  },
  durationGuideTxt: { ...typography.bodySmall, color: palette.textSecondary, flex: 1 },

  // HOURLY_CAPPED rate/min/cap card
  capCard: {
    marginTop:       spacing.md,
    backgroundColor: palette.primaryLight,
    borderRadius:    r.sm,
    padding:         spacing.md,
    gap:             4,
  },
  capHeadline: { ...typography.label, color: palette.primary, fontSize: 14 },
  capNote:     { ...typography.bodySmall, color: palette.textSecondary, lineHeight: 17 },

  // Structured brief fields (quote-first models)
  briefField:    { marginBottom: spacing.sm },
  briefQuestion: { ...typography.bodySmall, color: palette.textPrimary, marginBottom: 4 },
  briefInput: {
    backgroundColor: palette.background,
    borderRadius:    r.sm,
    borderWidth:     1,
    borderColor:     palette.border,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    minHeight:       44,
    fontFamily:      fontFamily.regular,
    fontSize:        14,
    color:           palette.textPrimary,
  },

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

  // Brief media (photos / short video)
  mediaHint: {
    ...typography.bodySmall,
    color:      palette.textSecondary,
    fontSize:   12,
    marginTop:  -4,
    marginBottom: spacing.sm,
  },
  mediaThumbRow: { marginBottom: spacing.sm },
  mediaThumb: {
    width:  64,
    height: 64,
    borderRadius: r.sm,
    overflow: 'hidden',
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
  },
  mediaThumbImg: { width: '100%', height: '100%' },
  mediaThumbPlayBadge: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  mediaThumbRemove: {
    position: 'absolute',
    top: 3, right: 3,
    width: 18, height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  mediaActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    paddingVertical: spacing.sm,
  },
  mediaActionBtnDisabled: { opacity: 0.4 },
  mediaActionTxt: { ...typography.label, color: palette.primary, fontSize: 12 },

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
  promoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: r.sm,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs,
    minHeight: 44,
  },
  promoInput: { ...typography.bodySmall, color: palette.textPrimary, flex: 1, paddingVertical: spacing.sm },
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
