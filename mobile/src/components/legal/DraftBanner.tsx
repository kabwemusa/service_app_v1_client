import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { palette, radius as r, spacing, typography } from '../../theme';

/**
 * "DRAFT — pending legal review" banner. Rendered ONLY when the backend reports
 * `draft_mode` (non-production, config/legal.php) so nobody mistakes the
 * placeholder scaffold for approved, binding legal text. In production, once the
 * documents are published and draft_mode is off, this never renders.
 */
export function DraftBanner({ draftMode }: { draftMode: boolean }) {
  if (!draftMode) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="construct-outline" size={16} color={palette.warning} />
      <Text style={styles.text}>
        DRAFT — placeholder wording pending review by a qualified Zambian lawyer.
        Not final or legally binding.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: palette.warningLight,
    borderColor: palette.warning,
    borderWidth: 1,
    borderRadius: r.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  text: {
    ...typography.bodySmall,
    color: palette.warning,
    flex: 1,
    fontFamily: 'DMSans_600SemiBold',
  },
});
