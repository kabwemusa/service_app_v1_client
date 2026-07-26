import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Switch, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { DataSubjectRequestType, legalApi } from '../../api/legal';
import { ConfirmDialog, ConfirmDialogConfig } from '../../components/ui/ConfirmDialog';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useAuthStore } from '../../store/authStore';
import { useConsentStore } from '../../store/consentStore';
import { palette, radius as r, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Data-subject rights (Data Protection Act No. 3 of 2021). Each opens a request;
// fulfilment (export/erasure) is handled out of band — see ConsentService.
const RIGHTS: { type: DataSubjectRequestType; label: string; sub: string; icon: IconName }[] = [
  { type: 'ACCESS', label: 'Access my data', sub: 'Get a copy of the personal data we hold', icon: 'download-outline' },
  { type: 'RECTIFICATION', label: 'Correct my data', sub: 'Ask us to fix inaccurate details', icon: 'create-outline' },
  { type: 'PORTABILITY', label: 'Export my data', sub: 'Receive your data in a portable form', icon: 'share-outline' },
  { type: 'OBJECTION', label: 'Object to processing', sub: 'Object to how your data is used', icon: 'hand-left-outline' },
  { type: 'RESTRICTION', label: 'Restrict processing', sub: 'Ask us to pause certain processing', icon: 'pause-circle-outline' },
  { type: 'ERASURE', label: 'Delete my data', sub: 'Ask us to erase your personal data', icon: 'trash-outline' },
];

/**
 * Profile → Privacy & consent (brief §C). The in-app path to withdraw consent
 * and exercise data-subject rights. Withdrawal is recorded; withdrawing CORE
 * consent surfaces that it ends the service before it proceeds.
 */
export default function PrivacyConsentScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { status, loading, refresh, accept, withdraw, submitting } = useConsentStore();
  const { logout } = useAuthStore();
  const { showSnackbar, showError } = useSnackbar();
  const [dialog, setDialog] = useState<ConfirmDialogConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  const marketing = status?.marketing_opt_in ?? false;
  const analytics = status?.analytics_opt_in ?? false;

  const toggleOptional = async (scope: 'marketing' | 'analytics', on: boolean) => {
    let ok: boolean;
    if (on) {
      // Turning an optional back on = a fresh, explicit consent that preserves
      // the other toggle's current state.
      ok = await accept({
        marketing: scope === 'marketing' ? true : marketing,
        analytics: scope === 'analytics' ? true : analytics,
      });
    } else {
      ok = await withdraw(scope);
    }
    if (!ok) showError('Could not update that. Please try again.');
  };

  const confirmWithdrawCore = () =>
    setDialog({
      title: 'Withdraw consent & leave?',
      message:
        'Sebenza needs your consent to the core processing (identity, booking, payment) to run. ' +
        'If you withdraw it, we can no longer provide the service and you will be signed out. ' +
        'Your consent history is kept as a record.',
      confirmLabel: 'Withdraw & sign out',
      cancelLabel: 'Keep using Sebenza',
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await withdraw('CORE');
          await legalApi.submitDataRequest('WITHDRAW_CONSENT', 'User withdrew core consent from the app.');
        } catch {
          // record best-effort; still sign out
        } finally {
          setBusy(false);
          setDialog(null);
          await logout();
        }
      },
    });

  const requestRight = (right: (typeof RIGHTS)[number]) =>
    setDialog({
      title: right.label,
      message:
        `We’ll record your request to ${right.label.toLowerCase()} and follow up using the contact ` +
        'details on your account. Do you want to send this request?',
      confirmLabel: 'Send request',
      destructive: right.type === 'ERASURE',
      onConfirm: async () => {
        setBusy(true);
        try {
          await legalApi.submitDataRequest(right.type);
          showSnackbar({ message: 'Request received. We’ll follow up on your account contact.' });
        } catch {
          showError('Could not send that request. Please try again.');
        } finally {
          setBusy(false);
          setDialog(null);
        }
      },
    });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScreenHeader title="Privacy & consent" back />
      {loading && !status ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          {/* What you've agreed to */}
          <Text style={styles.groupLabel}>What you’ve agreed to</Text>
          <View style={styles.card}>
            <View style={styles.infoRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color={palette.success} />
              <Text style={styles.infoText}>
                You’ve accepted the required agreements. You can read them any time.
              </Text>
            </View>
            <View style={styles.divider} />
            <TouchableRipple onPress={() => navigation.navigate('Legal')} borderless>
              <View style={styles.linkRow}>
                <Text style={styles.linkLabel}>View Legal & policies</Text>
                <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
              </View>
            </TouchableRipple>
          </View>

          {/* Optional processing — withdraw/turn on at will */}
          <Text style={styles.groupLabel}>Optional processing</Text>
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Marketing messages</Text>
                <Text style={styles.rowSub}>Offers and news. Turn off any time.</Text>
              </View>
              <Switch
                value={marketing}
                onValueChange={(v) => toggleOptional('marketing', v)}
                disabled={submitting}
                color={palette.primary}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Non-essential analytics</Text>
                <Text style={styles.rowSub}>Helps us improve. Turn off any time.</Text>
              </View>
              <Switch
                value={analytics}
                onValueChange={(v) => toggleOptional('analytics', v)}
                disabled={submitting}
                color={palette.primary}
              />
            </View>
          </View>

          {/* Data-subject rights */}
          <Text style={styles.groupLabel}>Your data rights</Text>
          <View style={styles.card}>
            {RIGHTS.map((right, i) => (
              <React.Fragment key={right.type}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableRipple onPress={() => requestRight(right)} borderless accessibilityRole="button" accessibilityLabel={right.label}>
                  <View style={styles.row}>
                    <View style={styles.iconChip}>
                      <Ionicons name={right.icon} size={18} color={palette.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>{right.label}</Text>
                      <Text style={styles.rowSub}>{right.sub}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
                  </View>
                </TouchableRipple>
              </React.Fragment>
            ))}
          </View>

          {/* Withdraw core consent */}
          <Text style={styles.groupLabel}>Withdraw consent</Text>
          <View style={styles.card}>
            <TouchableRipple onPress={confirmWithdrawCore} borderless accessibilityRole="button" accessibilityLabel="Withdraw consent and leave">
              <View style={styles.row}>
                <View style={[styles.iconChip, { backgroundColor: palette.dangerLight }]}>
                  <Ionicons name="close-circle-outline" size={18} color={palette.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: palette.danger }]}>Withdraw consent</Text>
                  <Text style={styles.rowSub}>Ends the service — you’ll be signed out</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
              </View>
            </TouchableRipple>
          </View>

          <Text style={styles.footNote}>
            You can also complain to the Office of the Data Protection Commissioner
            in Zambia. See the Privacy Policy for details.
          </Text>
        </ScrollView>
      )}

      <ConfirmDialog dialog={dialog} busy={busy || submitting} onDismiss={() => setDialog(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  groupLabel: {
    ...typography.label,
    fontSize: 13,
    color: palette.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  infoText: { ...typography.bodySmall, fontSize: 13, color: palette.textSecondary, flex: 1 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  linkLabel: { ...typography.label, fontSize: 14, color: palette.primary },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: r.sm,
    backgroundColor: palette.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { ...typography.body, fontSize: 15, color: palette.textPrimary },
  rowSub: { ...typography.bodySmall, fontSize: 12, color: palette.textSecondary, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border },
  footNote: {
    ...typography.bodySmall,
    fontSize: 12,
    color: palette.textDisabled,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
