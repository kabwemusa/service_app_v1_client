import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Button, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DURATION_OPTIONS, HOUR_OPTIONS, useBookingFlow } from '../../hooks/useBookingFlow';
import { LocationSearch } from '../ui/LocationSearch';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_H      = Math.min(SCREEN_H * 0.84, 700);
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
  // Add-ons selected on the service detail screen (v3.1 §5.3 / §6.2).
  // Displayed as fee-card line items and included in the total.
  selectedAddons?: { id: number; name: string; price: number }[];
  onBooked:        (bookingId: string) => void;
}

export function BookingSheet({ visible, onClose, serviceId, serviceTitle, basePrice, pricingModel = 'FIXED', selectedAddons = [], onBooked }: Props) {
  const insets          = useSafeAreaInsets();
  const translateY      = useSharedValue(SHEET_H);
  const backdropOpacity = useSharedValue(0);
  const flow            = useBookingFlow(serviceId);

  const close = useCallback(() => {
    translateY.value      = withSpring(SHEET_H, SPRING_CLOSE);
    backdropOpacity.value = withTiming(0, { duration: 200 }, () => onClose());
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      translateY.value      = withSpring(0, SPRING_OPEN);
      backdropOpacity.value = withTiming(0.55, { duration: 250 });
      flow.reset();
    }
  }, [visible]);

  // Drag-to-dismiss via PanResponder on the handle area
  const dragStart = useRef(0);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  (_, g) => g.dy > 4,
      onPanResponderGrant: () => {
        dragStart.current = 0;
      },
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.value = g.dy;
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_Y || g.vy > DISMISS_VEL) {
          close();
        } else {
          translateY.value = withSpring(0, SPRING_OPEN);
        }
      },
    }),
  ).current;

  const sheetStyle    = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  async function handleConfirm() {
    const booking = await flow.submit();
    if (booking) {
      close();
      onBooked(booking.id);
    }
  }

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
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>

        {/* ── Sheet ───────────────────────────────────────────── */}
        <KeyboardAvoidingView
          style={styles.kavWrapper}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Animated.View style={[styles.sheet, sheetStyle, { maxHeight: SHEET_H }]}>

            {/* Drag handle — pan responder attached here only */}
            <View style={styles.handleArea} {...panResponder.panHandlers}>
              <View style={styles.handle} />
            </View>

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.headerTitle} numberOfLines={1}>{serviceTitle}</Text>
                <Text style={styles.headerPrice}>ZMW {basePrice.toFixed(2)}</Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={close}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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

              {/* ── Date ──────────────────────────────────────── */}
              <Text style={styles.sLabel}>Date</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {flow.days.slice(0, 10).map((day, i) => {
                  const active = day.toDateString() === flow.selectedDay.toDateString();
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.dayChip, active && styles.chipSel]}
                      onPress={() => flow.setSelectedDay(day)}
                    >
                      <Text style={[styles.dayWkd, active && styles.chipTxtSel]}>
                        {day.toLocaleDateString('en', { weekday: 'short' })}
                      </Text>
                      <Text style={[styles.dayNum, active && styles.chipTxtSel]}>
                        {day.getDate()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* ── Start time ────────────────────────────────── */}
              <Text style={styles.sLabel}>Start time</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {HOUR_OPTIONS.map((h) => {
                  const active = h === flow.startHour;
                  return (
                    <TouchableOpacity
                      key={h}
                      style={[styles.timeChip, active && styles.chipSel]}
                      onPress={() => flow.setStartHour(h)}
                    >
                      <Text style={[styles.timeChipTxt, active && styles.chipTxtSel]}>
                        {h.toString().padStart(2, '0')}:00
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* ── Duration ──────────────────────────────────── */}
              <Text style={styles.sLabel}>Duration</Text>
              <View style={styles.durationRow}>
                {DURATION_OPTIONS.map((d) => {
                  const active = d === flow.durationHrs;
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[styles.durChip, active && styles.durChipSel]}
                      onPress={() => flow.setDurationHrs(d)}
                    >
                      <Text style={[styles.durTxt, active && styles.durTxtSel]}>
                        {d === 1 ? '1 hr' : `${d} hrs`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ── Time summary ──────────────────────────────── */}
              <View style={styles.summaryRow}>
                <Ionicons name="time-outline" size={13} color={palette.textSecondary} />
                <Text style={styles.summaryTxt}>{flow.summaryLabel}</Text>
              </View>

              {/* ── Location ──────────────────────────────────── */}
              <Text style={styles.sLabel}>Delivery location</Text>
              <LocationSearch
                value={flow.deliveryLocation}
                onChange={flow.handleLocationChange}
              />

              {/* ── Fee breakdown (§6.4 itemised checkout transparency) ── */}
              {(() => {
                const svcCost  = pricingModel === 'HOURLY' ? basePrice * flow.durationHrs : basePrice;
                const addonSum = selectedAddons.reduce((s, a) => s + a.price, 0);
                const prot     = Math.min((svcCost + addonSum) * 0.02, 50);
                const total    = svcCost + addonSum + prot;
                return (
                  <View style={styles.feeCard}>
                    <View style={styles.feeRow}>
                      <Text style={styles.feeLbl}>Service fee</Text>
                      <Text style={styles.feeAmt}>
                        ZMW {svcCost.toFixed(0)}
                        {pricingModel === 'HOURLY' ? ` (${flow.durationHrs} hr${flow.durationHrs > 1 ? 's' : ''})` : ''}
                      </Text>
                    </View>
                    {selectedAddons.map((addon) => (
                      <View key={addon.id} style={styles.feeRow}>
                        <Text style={styles.feeLbl} numberOfLines={1}>{addon.name}</Text>
                        <Text style={styles.feeAmt}>ZMW {addon.price.toFixed(0)}</Text>
                      </View>
                    ))}
                    <View style={styles.feeRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={styles.feeLbl}>Buyer protection (2%)</Text>
                        <Ionicons name="information-circle-outline" size={13} color={palette.textDisabled} />
                      </View>
                      <Text style={styles.feeAmt}>ZMW {prot.toFixed(0)}</Text>
                    </View>
                    <View style={styles.feeDivider} />
                    <View style={styles.feeRow}>
                      <Text style={styles.feeTotalLbl}>Total</Text>
                      <Text style={styles.feeTotalAmt}>ZMW {total.toFixed(0)}</Text>
                    </View>
                    <View style={styles.escrowBanner}>
                      <Ionicons name="lock-closed-outline" size={14} color={palette.success} />
                      <Text style={styles.escrowNote}>
                        Held securely in escrow — released to the provider only when you confirm the job is complete.
                      </Text>
                    </View>

                    {/* ── CTA ─────────────────────────────────────── */}
                    <Button
                      mode="contained"
                      style={styles.cta}
                      contentStyle={styles.ctaContent}
                      labelStyle={styles.ctaLabel}
                      onPress={handleConfirm}
                      loading={flow.submitting}
                      disabled={!flow.canSubmit}
                    >
                      {`Confirm booking · ZMW ${total.toFixed(0)}`}
                    </Button>
                  </View>
                );
              })()}

            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>

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
    // Slightly taller hit area than the visual handle
    paddingHorizontal: spacing.xl,
  },
  handle: {
    width:           36,
    height:          4,
    backgroundColor: palette.border,
    borderRadius:    r.full,
  },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.lg,
    paddingVertical:   spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  headerLeft:  { flex: 1 },
  headerTitle: { ...typography.label, color: palette.textPrimary, fontSize: 16 },
  headerPrice: { ...typography.bodySmall, color: palette.primary, marginTop: 2 },
  closeBtn: {
    width:           32,
    height:          32,
    borderRadius:    r.full,
    backgroundColor: palette.background,
    alignItems:      'center',
    justifyContent:  'center',
    marginLeft:      spacing.sm,
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

  dayChip: {
    width:           50,
    paddingVertical: spacing.sm,
    borderRadius:    r.md,
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
    borderRadius:      r.md,
    borderWidth:       1,
    borderColor:       palette.border,
    backgroundColor:   palette.background,
  },
  timeChipTxt: { ...typography.bodySmall, color: palette.textPrimary },

  durationRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  durChip: {
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    borderRadius:      r.md,
    borderWidth:       1,
    borderColor:       palette.border,
    backgroundColor:   palette.background,
  },
  durChipSel: { backgroundColor: palette.primaryLight, borderColor: palette.primary },
  durTxt:     { ...typography.bodySmall, color: palette.textPrimary },
  durTxtSel:  { ...typography.bodySmall, color: palette.primary },

  summaryRow: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing.xs,
    marginTop:       spacing.md,
    backgroundColor: palette.background,
    borderRadius:    r.md,
    borderWidth:     1,
    borderColor:     palette.border,
    padding:         spacing.sm,
  },
  summaryTxt: { ...typography.bodySmall, color: palette.textSecondary },

  // §6.4 fee breakdown
  feeCard: {
    marginTop:       spacing.lg,
    backgroundColor: palette.background,
    borderRadius:    r.lg,
    borderWidth:     1,
    borderColor:     palette.border,
    padding:         spacing.md,
    gap:             spacing.sm,
  },
  feeRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feeLbl:      { ...typography.bodySmall, color: palette.textSecondary },
  feeAmt:      { ...typography.bodySmall, color: palette.textPrimary },
  feeDivider:  { height: 1, backgroundColor: palette.border, marginVertical: 2 },
  feeTotalLbl: { ...typography.label, color: palette.textPrimary },
  feeTotalAmt: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: palette.primary },

  escrowBanner: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    gap:             spacing.xs,
    backgroundColor: palette.successLight,
    borderRadius:    r.md,
    padding:         spacing.sm,
  },
  escrowNote: { ...typography.bodySmall, color: palette.success, flex: 1, lineHeight: 17 },

  cta:        { borderRadius: r.lg, marginTop: spacing.sm },
  ctaContent: { height: 54 },
  ctaLabel:   { ...typography.label, fontSize: 15, letterSpacing: 0.2 },
});
