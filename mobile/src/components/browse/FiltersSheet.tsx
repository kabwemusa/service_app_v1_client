import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { searchApi } from '../../api/search';
import { DeliveryLocation } from '../../store/locationStore';
import {
  AvailabilityOption,
  DEFAULT_FILTERS,
  FilterState,
} from '../../store/browseStore';
import { palette, radius as r, shadow, spacing } from '../../theme';
import { fontFamily } from '../../theme/typography';

// ── Constants ────────────────────────────────────────────────────────────────

const BUDGET_MIN  = 100;
const BUDGET_MAX  = 1000;
const BUDGET_STEP = 50;
const THUMB_SIZE  = 24;
const TRACK_HEIGHT = 4;

// v3 §4.1 — exact tier labels used in the filters sheet
const TIER_OPTIONS: { value: 0 | 2 | 3 | 4; label: string }[] = [
  { value: 0, label: 'Any'                },
  { value: 2, label: 'Identified (T2)'   },
  { value: 3, label: 'Verified (T3)'     },
  { value: 4, label: 'Professional (T4)' },
];

// Supported language codes (v3.1 — only these four)
const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: 'en',  label: 'English' },
  { code: 'ny',  label: 'Nyanja'  },
  { code: 'bem', label: 'Bemba'   },
  { code: 'ton', label: 'Tonga'   },
];

const AVAILABILITY_OPTIONS: { value: AvailabilityOption; label: string }[] = [
  { value: 'any',   label: 'Any time'   },
  { value: 'today', label: 'Today'      },
  { value: 'week',  label: 'This week'  },
  { value: 'date',  label: 'Pick a date'},
];

// ── Budget Slider ─────────────────────────────────────────────────────────────

interface SliderProps {
  value:    number | null;   // null = no limit
  onChange: (v: number | null) => void;
}

function BudgetSlider({ value, onChange }: SliderProps) {
  const displayVal  = value ?? BUDGET_MAX;
  const trackWRef   = useRef(0);
  const currentXRef = useRef(0);
  const xAnim       = useRef(new Animated.Value(0)).current;
  // Stable offset so Animated.subtract doesn't create a new value each render
  const halfThumb   = useRef(new Animated.Value(THUMB_SIZE / 2)).current;
  const thumbTransX = useRef(Animated.subtract(xAnim, halfThumb)).current;

  const valueToX = (v: number, w: number) =>
    ((v - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) * w;

  const syncPosition = useCallback((v: number) => {
    if (trackWRef.current > 0) {
      const x = valueToX(v, trackWRef.current);
      xAnim.setValue(x);
      currentXRef.current = x;
    }
  }, [xAnim]);

  useEffect(() => { syncPosition(displayVal); }, [displayVal, syncPosition]);

  const onTrackLayout = (width: number) => {
    trackWRef.current = width;
    const x = valueToX(displayVal, width);
    xAnim.setValue(x);
    currentXRef.current = x;
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: () => {
        xAnim.stopAnimation((v) => { currentXRef.current = v; });
      },
      onPanResponderMove: (_, gs) => {
        const tw = trackWRef.current;
        const newX = Math.max(0, Math.min(tw, currentXRef.current + gs.dx));
        xAnim.setValue(newX);
      },
      onPanResponderRelease: (_, gs) => {
        const tw = trackWRef.current;
        if (tw === 0) return;
        const finalX  = Math.max(0, Math.min(tw, currentXRef.current + gs.dx));
        const rawVal  = BUDGET_MIN + (finalX / tw) * (BUDGET_MAX - BUDGET_MIN);
        const stepped = Math.round(rawVal / BUDGET_STEP) * BUDGET_STEP;
        const clamped = Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, stepped));
        const snappedX = valueToX(clamped, tw);
        xAnim.setValue(snappedX);
        currentXRef.current = snappedX;
        onChange(clamped >= BUDGET_MAX ? null : clamped);
      },
    })
  ).current;

  const label = displayVal >= BUDGET_MAX ? 'No limit' : `ZMW ${displayVal}`;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Max budget: ${label}`}
      accessibilityValue={{ min: BUDGET_MIN, max: BUDGET_MAX, now: displayVal, text: label }}
      accessibilityActions={[
        { name: 'increment', label: 'increase' },
        { name: 'decrement', label: 'decrease' },
      ]}
      onAccessibilityAction={(e) => {
        const cur = value ?? BUDGET_MAX;
        if (e.nativeEvent.actionName === 'increment') {
          const nv = Math.min(BUDGET_MAX, cur + BUDGET_STEP);
          onChange(nv >= BUDGET_MAX ? null : nv);
        } else if (e.nativeEvent.actionName === 'decrement') {
          onChange(Math.max(BUDGET_MIN, cur - BUDGET_STEP));
        }
      }}
    >
      <View style={slStyles.labelRow}>
        <Text style={slStyles.sectionLabel}>Max budget</Text>
        <Text style={slStyles.valueLabel}>{label}</Text>
      </View>

      {/* Track container — full-width layout measurement target */}
      <View
        style={slStyles.trackContainer}
        onLayout={(e) => onTrackLayout(e.nativeEvent.layout.width)}
      >
        {/* Track background */}
        <View style={slStyles.track}>
          {/* Fill — width equals the animated x position */}
          <Animated.View style={[slStyles.fill, { width: xAnim }]} />
        </View>

        {/* Thumb — centered on the animated x position */}
        <Animated.View
          {...pan.panHandlers}
          style={[
            slStyles.thumb,
            { transform: [{ translateX: thumbTransX }] },
          ]}
        />
      </View>
    </View>
  );
}

const slStyles = StyleSheet.create({
  labelRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   spacing.sm,
  },
  sectionLabel: {
    fontFamily: fontFamily.medium,
    fontSize:   14,
    color:      palette.textPrimary,
  },
  valueLabel: {
    fontFamily: fontFamily.medium,
    fontSize:   14,
    color:      palette.primary,
  },
  trackContainer: {
    height:         THUMB_SIZE,
    justifyContent: 'center',
    position:       'relative',
  },
  track: {
    height:          TRACK_HEIGHT,
    backgroundColor: palette.border,
    borderRadius:    TRACK_HEIGHT,
    overflow:        'hidden',
  },
  fill: {
    height:          TRACK_HEIGHT,
    backgroundColor: palette.primary,
    borderRadius:    TRACK_HEIGHT,
  },
  thumb: {
    position:    'absolute',
    left:        0,
    top:         (THUMB_SIZE - THUMB_SIZE) / 2,
    width:       THUMB_SIZE,
    height:      THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: palette.primary,
    borderWidth:  3,
    borderColor:  '#fff',
    ...shadow.card,
  },
});

// ── Section + Row helpers ─────────────────────────────────────────────────────

function SectionDivider() {
  return <View style={fStyles.divider} />;
}

function SectionHeading({ label }: { label: string }) {
  return <Text style={fStyles.sectionHeading}>{label}</Text>;
}

function OptionRow({
  label,
  selected,
  onPress,
}: {
  label:    string;
  selected: boolean;
  onPress:  () => void;
}) {
  return (
    <TouchableOpacity
      style={[fStyles.optRow, selected && fStyles.optRowSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
    >
      <Text style={[fStyles.optLabel, selected && fStyles.optLabelSelected]}>{label}</Text>
      {selected && <Ionicons name="checkmark" size={16} color={palette.primary} />}
    </TouchableOpacity>
  );
}

function ToggleRow({
  label,
  value,
  onToggle,
}: {
  label:    string;
  value:    boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      style={fStyles.toggleRow}
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
    >
      <Text style={fStyles.toggleLabel}>{label}</Text>
      <View style={[fStyles.pill, value && fStyles.pillActive]}>
        <Text style={[fStyles.pillTxt, value && fStyles.pillTxtActive]}>
          {value ? 'On' : 'Off'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── FiltersSheet ─────────────────────────────────────────────────────────────

interface Props {
  visible:        boolean;
  initial:        FilterState;
  categoryId?:    number;
  primaryLocation: DeliveryLocation | null;
  onApply:        (f: FilterState) => void;
  onClose:        () => void;
}

export function FiltersSheet({
  visible,
  initial,
  categoryId,
  primaryLocation,
  onApply,
  onClose,
}: Props) {
  // Local draft state — only written to the store when user taps Apply
  const [draft, setDraft] = useState<FilterState>(initial);

  // Live count state
  const [liveCount, setLiveCount]     = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync draft when sheet opens
  useEffect(() => {
    if (visible) setDraft(initial);
  }, [visible, initial]);

  // Debounced live count — calls search with page:1 to read total
  useEffect(() => {
    if (!visible) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setCountLoading(true);
      try {
        const params: any = { page: 1 };
        if (categoryId)                params.category_id = categoryId;
        if (primaryLocation) {
          params.lat = primaryLocation.lat;
          params.lng = primaryLocation.lng;
        }
        if (draft.maxBudget !== null)  params.max_price   = draft.maxBudget;
        if (draft.availability !== 'any') {
          params.availability = draft.availability;
          if (draft.availability === 'date' && draft.availabilityDate) {
            params.availability_date = draft.availabilityDate;
          }
        }
        if (draft.verifiedId)          params.verified_id = true;
        if (draft.topRated)            params.top_rated   = true;
        if (draft.minTier > 0)         params.min_tier    = draft.minTier;
        if (draft.languages.length > 0) params.languages  = draft.languages.join(',');

        const result = await searchApi.search(params);
        setLiveCount(result.total);
      } catch {
        setLiveCount(null);
      } finally {
        setCountLoading(false);
      }
    }, 250);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [visible, draft, categoryId, primaryLocation]);

  const patch = useCallback((p: Partial<FilterState>) => {
    setDraft((prev) => ({ ...prev, ...p }));
  }, []);

  const handleReset = () => {
    setDraft({ ...DEFAULT_FILTERS });
  };

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  const toggleLanguage = (code: string) => {
    setDraft((prev) => ({
      ...prev,
      languages: prev.languages.includes(code)
        ? prev.languages.filter((l) => l !== code)
        : [...prev.languages, code],
    }));
  };

  const buttonLabel = countLoading
    ? 'Calculating…'
    : liveCount === null
    ? 'Apply filters'
    : liveCount === 0
    ? 'No results — try loosening filters'
    : `Show ${liveCount} result${liveCount === 1 ? '' : 's'}`;

  const applyDisabled = liveCount === 0;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={fStyles.root}>
        <Pressable
          style={fStyles.backdrop}
          onPress={onClose}
          accessibilityLabel="Close filters"
          accessibilityRole="button"
        />

        <SafeAreaView edges={['bottom']} style={fStyles.sheetWrap}>
          <View style={fStyles.sheet}>
            {/* Handle */}
            <View style={fStyles.handle} />

            {/* Header: Reset · Filters · X */}
            <View style={fStyles.header}>
              <TouchableOpacity
                style={fStyles.headerAction}
                onPress={handleReset}
                accessibilityLabel="Reset all filters"
                accessibilityRole="button"
              >
                <Text style={fStyles.resetTxt}>Reset</Text>
              </TouchableOpacity>
              <Text style={fStyles.headerTitle}>Filters</Text>
              <TouchableOpacity
                style={fStyles.headerAction}
                onPress={onClose}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={20} color={palette.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Scrollable body */}
            <ScrollView
              style={fStyles.scroll}
              contentContainerStyle={fStyles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >

              {/* ── Budget slider ──────────────────────────────── */}
              <BudgetSlider
                value={draft.maxBudget}
                onChange={(v) => patch({ maxBudget: v })}
              />

              <SectionDivider />

              {/* ── Availability ───────────────────────────────── */}
              <SectionHeading label="Availability" />
              {AVAILABILITY_OPTIONS.map((opt) => (
                <OptionRow
                  key={opt.value}
                  label={opt.label}
                  selected={draft.availability === opt.value}
                  onPress={() => patch({ availability: opt.value, availabilityDate: null })}
                />
              ))}

              {/* Inline date input when "Pick a date" is selected */}
              {draft.availability === 'date' && (
                <View style={fStyles.dateRow}>
                  <Ionicons name="calendar-outline" size={16} color={palette.primary} />
                  <RNTextInput
                    style={fStyles.dateInput}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={palette.textDisabled}
                    value={draft.availabilityDate ?? ''}
                    onChangeText={(t) => patch({ availabilityDate: t || null })}
                    accessibilityLabel="Date — format YYYY-MM-DD"
                    maxLength={10}
                    keyboardType="numeric"
                  />
                </View>
              )}

              <SectionDivider />

              {/* ── Provider toggles ───────────────────────────── */}
              <SectionHeading label="Providers" />
              <ToggleRow
                label="Verified ID"
                value={draft.verifiedId}
                onToggle={() => patch({ verifiedId: !draft.verifiedId })}
              />
              <ToggleRow
                label="Top rated 4.5+"
                value={draft.topRated}
                onToggle={() => patch({ topRated: !draft.topRated })}
              />

              {/* Min trust tier — single-select, exact v3 §4.1 labels */}
              <Text style={[fStyles.sectionHeading, { marginTop: spacing.sm }]}>
                Minimum trust tier
              </Text>
              {TIER_OPTIONS.map((opt) => (
                <OptionRow
                  key={opt.value}
                  label={opt.label}
                  selected={draft.minTier === opt.value}
                  onPress={() => patch({ minTier: opt.value })}
                />
              ))}

              <SectionDivider />

              {/* ── Languages — multi-select ───────────────────── */}
              <SectionHeading label="Languages" />
              <View style={fStyles.chipGroup}>
                {LANGUAGE_OPTIONS.map((lang) => {
                  const active = draft.languages.includes(lang.code);
                  return (
                    <TouchableOpacity
                      key={lang.code}
                      style={[fStyles.langChip, active && fStyles.langChipActive]}
                      onPress={() => toggleLanguage(lang.code)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active }}
                      accessibilityLabel={lang.label}
                    >
                      <Text style={[fStyles.langChipTxt, active && fStyles.langChipTxtActive]}>
                        {lang.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Bottom padding so footer doesn't cover last item */}
              <View style={{ height: spacing.xl }} />
            </ScrollView>

            {/* Footer — live count CTA */}
            <View style={fStyles.footer}>
              {liveCount === 0 && (
                <Text style={fStyles.emptyWarning}>
                  No services match these filters — try resetting.
                </Text>
              )}
              <TouchableOpacity
                style={[fStyles.applyBtn, applyDisabled && fStyles.applyBtnDisabled]}
                onPress={handleApply}
                disabled={applyDisabled}
                accessibilityRole="button"
                accessibilityLabel={buttonLabel}
              >
                <Text style={[fStyles.applyTxt, applyDisabled && fStyles.applyTxtDisabled]}>
                  {buttonLabel}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const fStyles = StyleSheet.create({
  root:     { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },

  sheetWrap: {
    flex:                 1,
    backgroundColor:      palette.surface,
    borderTopLeftRadius:  r.xl,
    borderTopRightRadius: r.xl,
    maxHeight:            '88%',
  },
  sheet: {
    backgroundColor:      palette.surface,
    borderTopLeftRadius:  r.xl,
    borderTopRightRadius: r.xl,
    flex:                 1,
    ...shadow.modal,
  },

  handle: {
    alignSelf:       'center',
    width:           36,
    height:          4,
    borderRadius:    r.full,
    backgroundColor: palette.border,
    marginTop:       spacing.sm,
  },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical:   spacing.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  headerTitle: {
    fontFamily: fontFamily.medium,
    fontSize:   16,
    color:      palette.textPrimary,
  },
  headerAction: {
    minWidth:       44,
    minHeight:      44,
    alignItems:     'center',
    justifyContent: 'center',
  },
  resetTxt: {
    fontFamily: fontFamily.medium,
    fontSize:   14,
    color:      palette.primary,
  },

  scroll:        { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop:        spacing.md,
  },

  divider: {
    height:          1,
    backgroundColor: palette.border,
    marginVertical:  spacing.md,
  },

  sectionHeading: {
    fontFamily:   fontFamily.medium,
    fontSize:     13,
    color:        palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom:  spacing.sm,
  },

  optRow: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius:    r.md,
    minHeight:       44,
  },
  optRowSelected: { backgroundColor: palette.primaryLight },
  optLabel: {
    fontFamily: fontFamily.regular,
    fontSize:   15,
    color:      palette.textPrimary,
  },
  optLabelSelected: {
    fontFamily: fontFamily.medium,
    color:      palette.primary,
  },

  toggleRow: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingVertical:   spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    minHeight:         44,
  },
  toggleLabel: {
    fontFamily: fontFamily.regular,
    fontSize:   15,
    color:      palette.textPrimary,
  },
  pill: {
    borderRadius:      r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical:   4,
    borderWidth:       1,
    borderColor:       palette.border,
    backgroundColor:   palette.background,
  },
  pillActive: {
    backgroundColor: palette.primary,
    borderColor:     palette.primary,
  },
  pillTxt: {
    fontFamily: fontFamily.medium,
    fontSize:   12,
    color:      palette.textSecondary,
  },
  pillTxtActive: { color: '#fff' },

  dateRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing.sm,
    backgroundColor:   palette.background,
    borderRadius:      r.md,
    borderWidth:       1,
    borderColor:       palette.border,
    paddingHorizontal: spacing.sm,
    paddingVertical:   spacing.xs,
    marginTop:         spacing.xs,
    minHeight:         44,
  },
  dateInput: {
    flex:       1,
    fontFamily: fontFamily.regular,
    fontSize:   15,
    color:      palette.textPrimary,
  },

  chipGroup: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           spacing.sm,
  },
  langChip: {
    borderRadius:      r.full,
    borderWidth:       1,
    borderColor:       palette.border,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm - 2,
    backgroundColor:   palette.background,
    minHeight:         44,
    justifyContent:    'center',
  },
  langChipActive: {
    backgroundColor: palette.primaryLight,
    borderColor:     palette.primary,
  },
  langChipTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   14,
    color:      palette.textSecondary,
  },
  langChipTxtActive: {
    fontFamily: fontFamily.medium,
    color:      palette.primary,
  },

  footer: {
    padding:           spacing.lg,
    borderTopWidth:    1,
    borderTopColor:    palette.border,
    gap:               spacing.sm,
  },
  emptyWarning: {
    fontFamily: fontFamily.regular,
    fontSize:   13,
    color:      palette.warning,
    textAlign:  'center',
  },
  applyBtn: {
    backgroundColor: palette.primary,
    borderRadius:    r.full,
    height:          52,
    alignItems:      'center',
    justifyContent:  'center',
  },
  applyBtnDisabled: { backgroundColor: palette.border },
  applyTxt: {
    fontFamily: fontFamily.medium,
    fontSize:   16,
    color:      '#fff',
  },
  applyTxtDisabled: { color: palette.textDisabled },
});
