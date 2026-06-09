import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { palette, radius as r } from '../../theme';

interface Props {
  trustTier: number;
  size?: 'sm' | 'md';
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// v3 §9.2 — the 7 earned badges, shared visual map (label/icon/colour) used by
// the Hub badge row and the highlights editor's "choose from badges you've earned" picker.
// Earning rules themselves are computed server-side in `ProviderProfileService::earnedBadges()`.
export const EARNED_BADGE_META: Record<string, { label: string; icon: IconName; color: string }> = {
  VERIFIED:        { label: 'Verified',                icon: 'shield-checkmark',         color: palette.success   },
  PROFESSIONAL:    { label: 'Professional',            icon: 'ribbon-outline',           color: palette.primary   },
  QUICK_RESPONDER: { label: 'Quick Responder',         icon: 'flash-outline',            color: palette.warning   },
  TOP_RATED:       { label: 'Top Rated',               icon: 'star',                     color: palette.secondary },
  RISING_STAR:     { label: 'Rising Star',             icon: 'trending-up-outline',      color: palette.primary   },
  REPEAT_LOVED:    { label: 'Repeat-Client Favourite', icon: 'heart-outline',            color: palette.secondary },
  DISPUTE_FREE:    { label: 'Dispute-Free',            icon: 'shield-checkmark-outline', color: palette.success   },
};

// Labels and colors exactly match TrustTier enum (v3 §4.1).
const TIERS = {
  0: { label: 'Unverified',   color: palette.textDisabled, bg: '#EBEBEB',           icon: 'shield-outline'           },
  1: { label: 'Basic',        color: palette.warning,      bg: palette.warningLight, icon: 'shield-half-outline'     },
  2: { label: 'Identified',   color: palette.primary,      bg: palette.primaryLight, icon: 'shield-checkmark-outline' },
  3: { label: 'Verified',     color: palette.success,      bg: palette.successLight, icon: 'shield-checkmark'        },
  4: { label: 'Professional', color: palette.warning,      bg: palette.warningLight, icon: 'ribbon'                  },
} as const;

export function VettingBadge({ trustTier, size = 'sm' }: Props) {
  const tier = (Math.min(Math.max(trustTier ?? 0, 0), 4)) as 0 | 1 | 2 | 3 | 4;
  const cfg  = TIERS[tier];
  const sm   = size === 'sm';

  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }, sm ? styles.sm : styles.md]}>
      <Ionicons name={cfg.icon as any} size={sm ? 10 : 13} color={cfg.color} />
      <Text style={[styles.label, { color: cfg.color }, sm ? styles.labelSm : styles.labelMd]}>
        {cfg.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems:    'center',
    borderRadius:  r.full,
    gap: 3,
  },
  sm:      { paddingHorizontal: 6,  paddingVertical: 2 },
  md:      { paddingHorizontal: 10, paddingVertical: 4 },
  label:   { fontFamily: 'PlusJakartaSans_600SemiBold' },
  labelSm: { fontSize: 10 },
  labelMd: { fontSize: 12 },
});
