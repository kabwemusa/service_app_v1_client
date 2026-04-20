import { Ionicons } from '@expo/vector-icons';
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

type Role = 'CUSTOMER' | 'PROVIDER';

interface RoleOption {
  value: Role;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
}

const ROLES: RoleOption[] = [
  {
    value: 'CUSTOMER',
    icon: 'person-circle-outline',
    title: 'I need help',
    subtitle: 'Book trusted services',
  },
  {
    value: 'PROVIDER',
    icon: 'construct-outline',
    title: 'I offer services',
    subtitle: 'Earn on your own terms',
  },
];

export default function RegisterScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [usePhone, setUsePhone] = useState(false);
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('CUSTOMER');
  const [referralCode, setReferralCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const { register, loading, error, clearError } = useAuthStore();
  const { showError } = useSnackbar();

  useEffect(() => {
    if (error && !error.isValidation) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const emailError    = error?.isValidation ? error.fieldError('email') : null;
  const phoneError    = error?.isValidation ? error.fieldError('phone') : null;
  const passwordError = error?.isValidation ? error.fieldError('password') : null;
  const referralError = error?.isValidation ? error.fieldError('referral_code') : null;

  const handleRegister = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    register({
      ...(usePhone
        ? { phone: phone.trim() }
        : { email: email.trim().toLowerCase() }),
      password,
      role,
      ...(referralCode.trim() ? { referral_code: referralCode.trim().toUpperCase() } : {}),
    });
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
            <Text style={styles.heading}>Create your account</Text>
            <Text style={styles.subheading}>
              Sign up with your email or phone — no university required.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.roleLabel}>Choose your primary use</Text>
            <View style={styles.roleRow}>
              {ROLES.map((opt) => {
                const active = role === opt.value;
                return (
                  <TouchableRipple
                    key={opt.value}
                    onPress={() => { Haptics.selectionAsync(); setRole(opt.value); }}
                    borderless
                    style={[styles.roleCard, active && styles.roleCardActive]}
                  >
                    <View style={styles.roleCardInner}>
                      <Ionicons
                        name={opt.icon}
                        size={24}
                        color={active ? palette.primary : palette.textSecondary}
                      />
                      <Text style={[styles.roleTitle, active && styles.roleTitleActive]}>
                        {opt.title}
                      </Text>
                      <Text style={styles.roleSub}>{opt.subtitle}</Text>
                    </View>
                  </TouchableRipple>
                );
              })}
            </View>

            {/* Toggle: email vs phone */}
            <View style={styles.toggleRow}>
              <TouchableRipple
                onPress={() => setUsePhone(false)}
                borderless
                style={[styles.toggleBtn, !usePhone && styles.toggleBtnActive]}
              >
                <Text style={[styles.toggleLabel, !usePhone && styles.toggleLabelActive]}>
                  Email
                </Text>
              </TouchableRipple>
              <TouchableRipple
                onPress={() => setUsePhone(true)}
                borderless
                style={[styles.toggleBtn, usePhone && styles.toggleBtnActive]}
              >
                <Text style={[styles.toggleLabel, usePhone && styles.toggleLabelActive]}>
                  Phone
                </Text>
              </TouchableRipple>
            </View>

            {!usePhone ? (
              <View style={styles.inputGroup}>
                <TextInput
                  mode="outlined"
                  label="Email address"
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  value={email}
                  onChangeText={setEmail}
                  error={!!emailError}
                  style={styles.input}
                  outlineStyle={styles.inputOutline}
                  left={<TextInput.Icon icon="email-outline" />}
                />
                {emailError && (
                  <HelperText type="error" visible style={styles.helper}>{emailError}</HelperText>
                )}
              </View>
            ) : (
              <View style={styles.inputGroup}>
                <TextInput
                  mode="outlined"
                  label="Phone number"
                  placeholder="+260971234567"
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  value={phone}
                  onChangeText={setPhone}
                  error={!!phoneError}
                  style={styles.input}
                  outlineStyle={styles.inputOutline}
                  left={<TextInput.Icon icon="phone-outline" />}
                />
                {phoneError && (
                  <HelperText type="error" visible style={styles.helper}>{phoneError}</HelperText>
                )}
              </View>
            )}

            <View style={styles.inputGroup}>
              <TextInput
                mode="outlined"
                label="Password"
                placeholder="At least 10 characters"
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
                <HelperText type="error" visible style={styles.helper}>{passwordError}</HelperText>
              )}
            </View>

            <View style={styles.inputGroup}>
              <TextInput
                mode="outlined"
                label="Referral code (optional)"
                placeholder="e.g. ABC12345"
                autoCapitalize="characters"
                value={referralCode}
                onChangeText={setReferralCode}
                error={!!referralError}
                style={styles.input}
                outlineStyle={styles.inputOutline}
                left={<TextInput.Icon icon="ticket-outline" />}
              />
              {referralError && (
                <HelperText type="error" visible style={styles.helper}>{referralError}</HelperText>
              )}
            </View>

            <Button
              mode="contained"
              onPress={handleRegister}
              loading={loading}
              disabled={loading}
              style={styles.btn}
              contentStyle={styles.btnContent}
              labelStyle={styles.btnLabel}
            >
              Continue
            </Button>

            <TouchableRipple
              onPress={() => navigation.navigate('Login')}
              borderless
              style={styles.footer}
            >
              <Text style={styles.footerText}>
                Already have an account? <Text style={styles.footerLink}>Sign in</Text>
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
  hero: { marginBottom: spacing.lg, alignItems: 'center' },
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
  roleLabel: { ...typography.label, color: palette.textSecondary, marginBottom: spacing.sm },
  roleRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  roleCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: palette.border,
    borderRadius: r.lg,
    overflow: 'hidden',
  },
  roleCardActive: { borderColor: palette.primary, backgroundColor: palette.primaryLight },
  roleCardInner: { padding: spacing.md, alignItems: 'center', gap: spacing.xs },
  roleTitle: { ...typography.label, color: palette.textSecondary, textAlign: 'center' },
  roleTitleActive: { color: palette.primary },
  roleSub: { ...typography.bodySmall, color: palette.textSecondary, textAlign: 'center', fontSize: 12 },

  toggleRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: r.md,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  toggleBtnActive: { backgroundColor: palette.primaryLight },
  toggleLabel: { ...typography.label, color: palette.textSecondary },
  toggleLabelActive: { color: palette.primary },

  inputGroup: { marginBottom: spacing.sm },
  input: { backgroundColor: '#FFFFFF' },
  inputOutline: { borderRadius: r.lg },
  helper: { marginTop: -spacing.xs },
  btn: { marginTop: spacing.md, borderRadius: r.lg },
  btnContent: { height: 54 },
  btnLabel: { ...typography.label, fontSize: 16, letterSpacing: 0.2 },
  footer: {
    marginTop: spacing.md,
    borderRadius: r.md,
    alignSelf: 'center',
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
  },
  footerText: { ...typography.bodySmall, color: palette.textSecondary },
  footerLink: { ...typography.label, color: palette.primary },
});
