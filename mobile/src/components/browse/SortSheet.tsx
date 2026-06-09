import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SortOption } from '../../store/browseStore';
import { palette, radius as r, shadow, spacing } from '../../theme';
import { fontFamily } from '../../theme/typography';

// ── Sort option metadata ──────────────────────────────────────────────────────

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const SORT_OPTIONS: { value: SortOption; label: string; icon: IconName; sub: string }[] = [
  {
    value: 'recommended',
    label: 'Recommended',
    icon:  'sparkles-outline',
    sub:   'Best match for your location',
  },
  {
    value: 'top_rated',
    label: 'Top rated',
    icon:  'star-outline',
    sub:   'Highest Bayesian rating first',
  },
  {
    value: 'price_asc',
    label: 'Price: low to high',
    icon:  'pricetag-outline',
    sub:   'Cheapest first; by-quote last',
  },
  {
    value: 'fastest',
    label: 'Fastest to respond',
    icon:  'flash-outline',
    sub:   'Quickest reply time first',
  },
  {
    value: 'nearest',
    label: 'Nearest',
    icon:  'location-outline',
    sub:   'Closest to your delivery location',
  },
];

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  visible:   boolean;
  current:   SortOption;
  onSelect:  (sort: SortOption) => void;
  onClose:   () => void;
}

export function SortSheet({ visible, current, onSelect, onClose }: Props) {
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let reducedMotion = false;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { reducedMotion = v; });

    if (visible) {
      Animated.timing(slideAnim, {
        toValue:         1,
        duration:        reducedMotion ? 0 : 240,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue:         0,
        duration:        reducedMotion ? 0 : 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const handleSelect = (sort: SortOption) => {
    onSelect(sort);
    onClose();
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel="Close sort options"
          accessibilityRole="button"
        />
        <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <View style={{ width: 28 }} />
              <Text style={styles.headerTitle}>Sort</Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={20} color={palette.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Options */}
            <View style={styles.body}>
              {SORT_OPTIONS.map((opt) => {
                const selected = current === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => handleSelect(opt.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={opt.label}
                  >
                    <View style={[styles.optionIcon, selected && styles.optionIconSelected]}>
                      <Ionicons
                        name={opt.icon}
                        size={18}
                        color={selected ? '#fff' : palette.textSecondary}
                      />
                    </View>
                    <View style={styles.optionBody}>
                      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                        {opt.label}
                      </Text>
                      <Text style={styles.optionSub} numberOfLines={1}>{opt.sub}</Text>
                    </View>
                    {selected && (
                      <Ionicons name="checkmark-circle" size={20} color={palette.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:     { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },

  sheetWrap: {
    backgroundColor:      palette.surface,
    borderTopLeftRadius:  r.xl,
    borderTopRightRadius: r.xl,
  },
  sheet: {
    backgroundColor:      palette.surface,
    borderTopLeftRadius:  r.xl,
    borderTopRightRadius: r.xl,
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
  closeBtn: {
    width:          28,
    height:         28,
    alignItems:     'center',
    justifyContent: 'center',
  },

  body: {
    padding:    spacing.lg,
    gap:        spacing.xs,
    paddingBottom: spacing.xl,
  },

  option: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius:    r.md,
    minHeight:       44,
  },
  optionSelected: {
    backgroundColor: palette.primaryLight,
  },
  optionIcon: {
    width:          38,
    height:         38,
    borderRadius:   r.full,
    backgroundColor: palette.background,
    borderWidth:    1,
    borderColor:    palette.border,
    alignItems:     'center',
    justifyContent: 'center',
  },
  optionIconSelected: {
    backgroundColor: palette.primary,
    borderColor:     palette.primary,
  },
  optionBody: { flex: 1 },
  optionLabel: {
    fontFamily: fontFamily.medium,
    fontSize:   14,
    color:      palette.textPrimary,
  },
  optionLabelSelected: { color: palette.primary },
  optionSub: {
    fontFamily: fontFamily.regular,
    fontSize:   12,
    color:      palette.textSecondary,
    marginTop:  1,
  },
});
