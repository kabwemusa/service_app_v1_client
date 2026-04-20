import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, HelperText, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useAuthStore } from '../../store/authStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

export default function LoginScreen({ navigation }: any) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const { login, loading, error, clearError } = useAuthStore();
  const { showError } = useSnackbar();

  useEffect(() => {
    if (error && !error.isValidation) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const identifierError = error?.isValidation ? (error.fieldError('identifier') ?? error.fieldError('email') ?? error.fieldError('phone')) : null;
  const passwordError   = error?.isValidation ? error.fieldError('password') : null;

  const handleLogin = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    login({ identifier: identifier.trim(), password });
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
              colors={['#FFFFFF', '#EDF3FF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.brandPill}
            >
              <Text style={styles.wordmark}>sebenza</Text>
            </LinearGradient>
            <Text style={styles.heading}>Welcome back</Text>
            <Text style={styles.subheading}>
              Sign in with your email or phone number.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.inputGroup}>
              <TextInput
                mode="outlined"
                label="Email or phone number"
                placeholder="you@email.com or +260971234567"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                value={identifier}
                onChangeText={setIdentifier}
                error={!!identifierError}
                style={styles.input}
                outlineStyle={styles.inputOutline}
                left={<TextInput.Icon icon="account-outline" />}
              />
              {identifierError && (
                <HelperText type="error" visible style={styles.helper}>
                  {identifierError}
                </HelperText>
              )}
            </View>

            <View style={styles.inputGroup}>
              <TextInput
                mode="outlined"
                label="Password"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                error={!!passwordError}
                style={styles.input}
                outlineStyle={styles.inputOutline}
                left={<TextInput.Icon icon="lock-outline" />}
                right={(
                  <TextInput.Icon
                    icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    onPress={() => setShowPassword((v) => !v)}
                  />
                )}
              />
              {passwordError && (
                <HelperText type="error" visible style={styles.helper}>
                  {passwordError}
                </HelperText>
              )}
            </View>

            <Button
              mode="contained"
              onPress={handleLogin}
              loading={loading}
              disabled={loading}
              style={styles.btn}
              contentStyle={styles.btnContent}
              labelStyle={styles.btnLabel}
            >
              Sign In
            </Button>

            <TouchableRipple
              onPress={() => navigation.navigate('Register')}
              borderless
              style={styles.footer}
            >
              <Text style={styles.footerText}>
                New here? <Text style={styles.footerLink}>Create account</Text>
              </Text>
            </TouchableRipple>
          </View>
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
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  brandPill: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md + 2,
    borderRadius: r.full,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.md,
  },
  wordmark: {
    ...typography.heading3,
    color: palette.primary,
    fontSize: 26,
    letterSpacing: -0.3,
  },
  heading: {
    ...typography.heading1,
    color: palette.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subheading: {
    ...typography.body,
    color: palette.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: palette.surface,
    borderRadius: r.xl,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  inputGroup: { marginBottom: spacing.sm },
  input: { backgroundColor: '#FFFFFF' },
  inputOutline: { borderRadius: r.lg },
  helper: { marginTop: -spacing.xs },
  btn: {
    marginTop: spacing.md,
    borderRadius: r.lg,
  },
  btnContent: { height: 54 },
  btnLabel: {
    ...typography.label,
    fontSize: 16,
    letterSpacing: 0.2,
  },
  footer: {
    marginTop: spacing.md,
    borderRadius: r.md,
    alignSelf: 'center',
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
  },
  footerText: {
    ...typography.bodySmall,
    color: palette.textSecondary,
  },
  footerLink: {
    ...typography.label,
    color: palette.primary,
  },
});
