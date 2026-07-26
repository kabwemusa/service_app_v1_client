import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useAuthStore } from '../../store/authStore';
import { palette, radius as r, spacing, typography } from '../../theme';

const BOX_COUNT = 6;

export default function OtpScreen() {
  const [digits, setDigits] = useState<string[]>(Array(BOX_COUNT).fill(''));
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(60);
  const inputs = useRef<(TextInput | null)[]>([]);

  const { verifyOtp, resendOtp, loading, error, clearError, pendingIdentifier } = useAuthStore();
  const { showError } = useSnackbar();

  // Verification channel follows the identifier the account was registered with.
  const isEmail = !!pendingIdentifier?.includes('@');

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (error && !error.isValidation) {
      showError(error.message);
      clearError();
      setDigits(Array(BOX_COUNT).fill(''));
      setTimeout(() => inputs.current[0]?.focus(), 100);
    }
  }, [error]);

  const otpFieldError = error?.isValidation ? error.fieldError('otp') : null;

  const handleChange = (value: string, index: number) => {
    if (loading) return;

    const updated = [...digits];
    updated[index] = value;
    setDigits(updated);

    if (value && index < BOX_COUNT - 1) {
      inputs.current[index + 1]?.focus();
    }

    if (updated.every((digit) => digit !== '')) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      verifyOtp(updated.join(''));
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await resendOtp();
    setCountdown(60);
    setDigits(Array(BOX_COUNT).fill(''));
    setTimeout(() => inputs.current[0]?.focus(), 100);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <LinearGradient
              colors={['#F5F9FF', '#E8F0FE']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.iconBadge}
            >
              <Ionicons name={isEmail ? 'mail-outline' : 'chatbubble-ellipses-outline'} size={34} color={palette.primary} />
            </LinearGradient>
            <Text style={styles.heading}>{isEmail ? 'Verify your email' : 'Verify your phone'}</Text>
            <Text style={styles.subheading}>
              Enter the 6-digit code sent to
              {pendingIdentifier ? (
                <Text style={styles.emailHighlight}>{`\n${pendingIdentifier}`}</Text>
              ) : (
                isEmail ? ' your email inbox' : ' your phone by SMS'
              )}
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.boxRow}>
              {digits.map((digit, index) => {
                const focused = focusedIndex === index;
                const hasValue = digit !== '';
                const hasError = !!otpFieldError;
                return (
                  <TextInput
                    key={index}
                    ref={(ref) => {
                      inputs.current[index] = ref;
                    }}
                    style={[
                      styles.box,
                      focused && styles.boxFocused,
                      hasValue && styles.boxFilled,
                      hasError && styles.boxError,
                    ]}
                    maxLength={1}
                    keyboardType="number-pad"
                    value={digit}
                    onChangeText={(value) => handleChange(value, index)}
                    onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, index)}
                    onFocus={() => setFocusedIndex(index)}
                    onBlur={() => setFocusedIndex(null)}
                    selectionColor={palette.primary}
                    caretHidden
                  />
                );
              })}
            </View>

            {otpFieldError && <Text style={styles.fieldError}>{otpFieldError}</Text>}

            {loading && (
              <ActivityIndicator
                color={palette.primary}
                size="small"
                style={styles.loader}
              />
            )}

            <View style={styles.resendArea}>
              {countdown > 0 ? (
                <Text style={styles.countdown}>
                  Resend code in <Text style={styles.countdownBold}>{countdown}s</Text>
                </Text>
              ) : (
                <TouchableRipple
                  onPress={handleResend}
                  borderless
                  style={styles.resendBtn}
                >
                  <Text style={styles.resendText}>Resend code</Text>
                </TouchableRipple>
              )}
            </View>
          </View>

          <Text style={styles.hint}>
            Tip: check promotions or spam if it has not arrived after a minute.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  iconBadge: {
    width: 84,
    height: 84,
    borderRadius: r.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.md,
  },
  heading: {
    ...typography.heading2,
    color: palette.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subheading: {
    ...typography.body,
    color: palette.textSecondary,
    textAlign: 'center',
    maxWidth: 340,
  },
  emailHighlight: {
    ...typography.label,
    color: palette.primary,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
  },
  boxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs + 2,
    marginBottom: spacing.sm,
  },
  box: {
    width: 44,
    height: 54,
    borderWidth: 1.5,
    borderColor: palette.border,
    borderRadius: r.md,
    textAlign: 'center',
    fontSize: 22,
    fontFamily: 'DMSans_700Bold',
    color: palette.textPrimary,
    backgroundColor: '#FFFFFF',
  },
  boxFocused: {
    borderColor: palette.primary,
    borderWidth: 2,
    backgroundColor: '#F7FAFF',
  },
  boxFilled: {
    borderColor: palette.primary,
  },
  boxError: {
    borderColor: palette.danger,
  },
  fieldError: {
    ...typography.bodySmall,
    color: palette.danger,
    textAlign: 'center',
  },
  loader: {
    marginTop: spacing.sm,
  },
  resendArea: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  countdown: {
    ...typography.bodySmall,
    color: palette.textSecondary,
  },
  countdownBold: {
    ...typography.label,
    color: palette.textPrimary,
  },
  resendBtn: {
    borderRadius: r.md,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  resendText: {
    ...typography.label,
    color: palette.primary,
  },
  hint: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
});
