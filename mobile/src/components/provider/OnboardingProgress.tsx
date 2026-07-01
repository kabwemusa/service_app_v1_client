import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ProgressBar, Text } from 'react-native-paper';
import { palette, spacing, typography } from '../../theme';

export const ONBOARDING_TOTAL_STEPS = 6;

const STEP_LABELS: Record<number, string> = {
  1: 'Create account',
  2: 'Your profile',
  3: 'Add your service',
  4: 'Verify identity',
  5: 'Payment details',
  6: 'Go live',
};

/**
 * Persistent onboarding progress affordance shown at the top of every setup
 * step screen (milestones 2–6). Tells the provider where they are and how much
 * is left, so the six-milestone timeline feels like ONE ordered flow rather
 * than a set of disconnected forms.
 *
 * Rendered only when a screen is opened from the setup timeline (i.e. the
 * `onboardingStep` route param is present) — the same screens are reused for
 * normal edit/verify flows where this bar should NOT appear.
 *
 * Horizontal padding is intentionally omitted so the bar inherits the host
 * screen's content padding; pass `style` for full-bleed hosts.
 */
export function OnboardingProgress({
  step,
  style,
}: {
  step: number;
  style?: StyleProp<ViewStyle>;
}) {
  const clamped = Math.min(Math.max(Math.round(step), 1), ONBOARDING_TOTAL_STEPS);
  return (
    <View
      style={[styles.wrap, style]}
      accessibilityLabel={`Setup, step ${clamped} of ${ONBOARDING_TOTAL_STEPS}: ${STEP_LABELS[clamped] ?? ''}`}
    >
      <View style={styles.row}>
        <Text style={styles.label}>
          Step {clamped} of {ONBOARDING_TOTAL_STEPS}
        </Text>
        <Text style={styles.stepName} numberOfLines={1}>
          {STEP_LABELS[clamped]}
        </Text>
      </View>
      <ProgressBar
        progress={clamped / ONBOARDING_TOTAL_STEPS}
        color={palette.primary}
        style={styles.bar}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm, marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  label: { ...typography.label, fontSize: 12, color: palette.primary },
  stepName: {
    ...typography.bodySmall,
    fontSize: 12,
    color: palette.textSecondary,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: spacing.sm,
  },
  bar: { height: 4, borderRadius: 2, backgroundColor: palette.border },
});
