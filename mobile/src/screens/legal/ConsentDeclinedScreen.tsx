import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useConsentStore } from '../../store/consentStore';
import { palette, radius as r, spacing, typography } from '../../theme';

/**
 * Shown when the user DECLINES at the consent gate (brief §A). Respectful, no
 * dark patterns, no guilt copy, no nagging. Two honest choices: review the
 * agreements again, or exit (which signs out cleanly — a declining user is never
 * partially onboarded). "You're welcome back any time."
 */
export default function ConsentDeclinedScreen() {
  const { clearDeclined } = useConsentStore();
  const { logout } = useAuthStore();

  const onReviewAgain = () => clearDeclined(); // back to the gate
  const onExit = async () => {
    await logout(); // ends the session cleanly; returns to the entry screen
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.iconBadge}>
          <Ionicons name="hand-left-outline" size={30} color={palette.primary} />
        </View>
        <Text style={styles.heading}>We understand</Text>
        <Text style={styles.body}>
          Sebenza can’t provide the service without agreement to the core Terms and
          the essential privacy processing. That’s completely your choice.
        </Text>
        <Text style={styles.body}>You’re welcome back any time.</Text>

        <View style={styles.actions}>
          <TouchableRipple
            style={styles.primaryBtn}
            onPress={onReviewAgain}
            borderless
            accessibilityRole="button"
            accessibilityLabel="Review again"
          >
            <Text style={styles.primaryText}>Review again</Text>
          </TouchableRipple>
          <TouchableRipple
            style={styles.secondaryBtn}
            onPress={onExit}
            borderless
            accessibilityRole="button"
            accessibilityLabel="Exit"
          >
            <Text style={styles.secondaryText}>Exit</Text>
          </TouchableRipple>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heading: { ...typography.heading2, color: palette.textPrimary, textAlign: 'center' },
  body: {
    ...typography.body,
    fontSize: 15,
    color: palette.textSecondary,
    textAlign: 'center',
    maxWidth: 340,
  },
  actions: { width: '100%', maxWidth: 360, marginTop: spacing.xl, gap: spacing.sm },
  primaryBtn: {
    height: 52,
    borderRadius: r.sm,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...typography.label, fontSize: 16, color: '#FFFFFF' },
  secondaryBtn: {
    height: 52,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...typography.label, fontSize: 15, color: palette.textSecondary },
});
