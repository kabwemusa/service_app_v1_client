import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { palette, radius as r, spacing } from '../../theme';

const HAIRLINE = StyleSheet.hairlineWidth;

export interface CardProps {
  children: React.ReactNode;
  style?:   StyleProp<ViewStyle>;
  /**
   * Internal padding (default 16). Pass `0` for list/section cards whose rows
   * pad themselves and are split edge-to-edge by <Divider />.
   */
  padding?: number;
}

/**
 * Canonical content container (v3.1 §2 design language).
 *
 *   • flat white surface, hairline (0.5px) border, 8px radius
 *   • NO drop shadow, NO elevation, NO glow
 *   • sits on the page background with a consistent gap between cards
 *
 * This is the ONLY content container in the app — compose screens from it and
 * never nest a Card inside a Card. Dark-mode screens override the surface/border
 * colours by passing `style={{ backgroundColor, borderColor }}` (applied last).
 */
export function Card({ children, style, padding = spacing.md }: CardProps) {
  return <View style={[styles.card, { padding }, style]}>{children}</View>;
}

export interface DividerProps {
  /** Horizontal inset so the rule doesn't run to the card edge (default 16). */
  inset?: number;
  /** Override colour for dark screens, e.g. `{ backgroundColor: c.border }`. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Hairline separator used INSIDE a Card to split rows / sub-sections (v3.1 §2).
 * Use this — never whitespace alone and never a nested card — to divide the
 * logical groups within one card.
 */
export function Divider({ inset = spacing.md, style }: DividerProps) {
  return <View style={[styles.divider, { marginHorizontal: inset }, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderWidth:     HAIRLINE,
    borderColor:     palette.border,
    borderRadius:    r.sm,
    overflow:        'hidden',
  },
  divider: {
    height:          HAIRLINE,
    backgroundColor: palette.border,
  },
});
