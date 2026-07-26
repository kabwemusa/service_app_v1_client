import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useProfileStore } from '../../store/profileStore';
import { palette, radius as r, spacing, typography } from '../../theme';

const MOMO_PROVIDERS = ['MTN', 'AIRTEL', 'ZAMTEL'] as const;
type MomoProvider = typeof MOMO_PROVIDERS[number];

/**
 * Getting-paid details — its OWN screen (not the profile editor). Providers set
 * the mobile-money wallet they get paid on, and jump to their earnings/payout
 * history. Copy adapts to the account's payment mode:
 *  · DIRECT  → customers pay this number directly for each job.
 *  · ESCROW  → the platform pays out to this wallet after the hold.
 */
export default function ProviderPayoutScreen({ navigation }: any) {
  const { profile, dashboard, loading, error, fetchProfile, fetchDashboard, upsertProfile, clearError } = useProfileStore();
  const { showSuccess, showError } = useSnackbar();
  const insets = useSafeAreaInsets();

  const [momoProvider, setMomoProvider] = useState<MomoProvider | ''>('');
  const [momoNumber, setMomoNumber]     = useState('');
  const [saving, setSaving]             = useState(false);

  useEffect(() => { fetchProfile(); fetchDashboard(); }, []);

  useEffect(() => {
    if (!profile) return;
    setMomoProvider((profile.momo_provider ?? '') as MomoProvider | '');
    setMomoNumber(profile.momo_number ?? '');
  }, [profile?.user_id]);

  useEffect(() => {
    if (error && !error.isValidation) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const momoErr = error?.isValidation ? error.fieldError('momo_number') : null;
  const isDirect = dashboard?.payment_mode === 'DIRECT';

  const handleSave = async () => {
    if (!momoNumber.trim() || !momoProvider) {
      showError('Choose your network and enter your mobile-money number.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaving(true);
    try {
      await upsertProfile({
        momo_provider: momoProvider as MomoProvider,
        momo_number:   momoNumber.trim(),
      });
      showSuccess(isDirect ? 'Payment details saved.' : 'Payout details saved.');
    } catch {
    } finally {
      setSaving(false);
    }
  };

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScreenHeader title={isDirect ? 'Payment details' : 'Payout details'} back />
        <View style={styles.skeletons}>
          {[1, 2].map((k) => <CardSkeleton key={k} style={styles.skeleton} />)}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScreenHeader title={isDirect ? 'Payment details' : 'Payout details'} back />
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionHelp}>
            {isDirect
              ? 'Customers with an active booking pay you directly on this mobile-money number.'
              : 'The platform pays your earnings out to this mobile-money wallet after the payout hold.'}
          </Text>

          <Text style={styles.sectionLabel}>Mobile money network</Text>
          <View style={[styles.card, styles.momoRow]}>
            {MOMO_PROVIDERS.map((provider) => {
              const active = momoProvider === provider;
              return (
                <TouchableRipple
                  key={provider}
                  onPress={() => { Haptics.selectionAsync(); setMomoProvider(provider); }}
                  borderless
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.momoBtn, active && styles.momoBtnActive]}
                >
                  <Text style={[styles.momoBtnText, active && styles.momoBtnTextActive]}>{provider}</Text>
                </TouchableRipple>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>Mobile money number</Text>
          <View style={styles.card}>
            <TextInput
              mode="outlined"
              label="MoMo number"
              placeholder="e.g. 0977123456"
              keyboardType="phone-pad"
              value={momoNumber}
              onChangeText={setMomoNumber}
              error={!!momoErr}
              style={styles.input}
              outlineStyle={styles.inputOutline}
              left={<TextInput.Icon icon="cellphone" />}
            />
            {momoErr && <HelperText type="error" visible>{momoErr}</HelperText>}
            <Text style={styles.privacyNote}>
              {isDirect
                ? 'Shared only with customers who have an active booking — never shown on your public profile.'
                : 'Used only for your payouts — never shown on your public profile.'}
            </Text>
          </View>

          <Button
            mode="contained"
            onPress={handleSave}
            loading={saving}
            disabled={saving}
            style={styles.cta}
            contentStyle={styles.ctaContent}
          >
            Save details
          </Button>

          {/* Payout / earnings history lives in the Earnings tab. */}
          <TouchableRipple
            onPress={() => navigation.navigate('Earnings')}
            borderless
            accessibilityRole="button"
            accessibilityLabel="View earnings and payout history"
            style={styles.historyBtn}
          >
            <View style={styles.historyInner}>
              <Ionicons name="receipt-outline" size={18} color={palette.primary} />
              <Text style={styles.historyText}>
                {isDirect ? 'View earnings & job history' : 'View earnings & payout history'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={palette.textSecondary} />
            </View>
          </TouchableRipple>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingTop: spacing.md },

  skeletons: { padding: spacing.lg, gap: spacing.md },
  skeleton: { height: 110, borderRadius: r.sm },

  sectionHelp: { ...typography.bodySmall, color: palette.textSecondary, lineHeight: 18, marginBottom: spacing.md },
  sectionLabel: { ...typography.label, color: palette.textSecondary, marginBottom: spacing.sm },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },

  momoRow: { flexDirection: 'row', gap: spacing.sm },
  momoBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: spacing.sm,
    borderRadius: r.sm,
    borderWidth: 1.5,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  momoBtnActive:     { borderColor: palette.primary, backgroundColor: palette.primaryLight },
  momoBtnText:       { ...typography.label, color: palette.textSecondary },
  momoBtnTextActive: { color: palette.primary },

  input: { backgroundColor: '#FFFFFF' },
  inputOutline: { borderRadius: r.sm },
  privacyNote: { ...typography.bodySmall, color: palette.textDisabled, fontSize: 12, lineHeight: 17 },

  cta: { borderRadius: r.sm, marginTop: spacing.xs },
  ctaContent: { height: 54 },

  historyBtn: { borderRadius: r.sm, marginTop: spacing.md, borderWidth: 1, borderColor: palette.border },
  historyInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md },
  historyText: { ...typography.label, color: palette.textPrimary, flex: 1 },
});
