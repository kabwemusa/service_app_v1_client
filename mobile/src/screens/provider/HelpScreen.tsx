import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { palette, radius as r, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const SUPPORT_EMAIL = 'support@sebenza.app';
const EMERGENCY_LINE = '991';

const FAQS: { q: string; a: string }[] = [
  { q: 'How do I get paid?', a: 'Set your mobile-money number under Account → Payout details. Customers with an active booking pay you directly on that number.' },
  { q: 'Why can’t customers find me?', a: 'You need Tier 1 verification, a profile that’s at least 40% complete, and one active service. Check the setup timeline on your Hub.' },
  { q: 'How do I raise my weekly cap?', a: 'Your earning cap grows as you reach higher trust tiers. See Account → Current tier level for what unlocks next.' },
];

/**
 * Help & support — a real destination (not a "coming soon" toast). Gives the
 * provider a direct line to support plus answers to the most common questions.
 */
export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const { showSnackbar } = useSnackbar();

  const open = (url: string) => async () => {
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error('unsupported');
      await Linking.openURL(url);
    } catch {
      showSnackbar({ message: 'Could not open that on this device.' });
    }
  };

  const ContactRow = ({ icon, label, sub, onPress, tint }: { icon: IconName; label: string; sub: string; onPress: () => void; tint?: string }) => (
    <TouchableRipple onPress={onPress} borderless accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.row}>
        <View style={[styles.iconChip, { backgroundColor: tint ? palette.dangerLight : palette.primaryLight }]}>
          <Ionicons name={icon} size={18} color={tint ?? palette.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
      </View>
    </TouchableRipple>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Help & support" back />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.groupLabel}>Contact us</Text>
        <View style={styles.card}>
          <ContactRow
            icon="mail-outline"
            label="Email support"
            sub={SUPPORT_EMAIL}
            onPress={open(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Sebenza provider support')}`)}
          />
          <View style={styles.divider} />
          <ContactRow
            icon="call-outline"
            label="Emergency line"
            sub={`Call ${EMERGENCY_LINE} if you feel unsafe on a job`}
            onPress={open(`tel:${EMERGENCY_LINE}`)}
            tint={palette.danger}
          />
        </View>

        <Text style={styles.groupLabel}>Frequently asked</Text>
        <View style={styles.card}>
          {FAQS.map((f, i) => (
            <View key={f.q}>
              {i > 0 && <View style={styles.divider} />}
              <View style={styles.faq}>
                <Text style={styles.faqQ}>{f.q}</Text>
                <Text style={styles.faqA}>{f.a}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.footer}>We usually reply within one business day.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { padding: spacing.lg, paddingTop: spacing.md },

  groupLabel: { ...typography.label, color: palette.textSecondary, fontSize: 13, marginBottom: spacing.sm, marginTop: spacing.xs },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, paddingVertical: spacing.sm },
  iconChip: { width: 38, height: 38, borderRadius: r.sm, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...typography.body, fontSize: 16, color: palette.textPrimary },
  rowSub: { ...typography.bodySmall, fontSize: 12, color: palette.textSecondary, marginTop: 1 },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginLeft: 38 + spacing.md },

  faq: { paddingVertical: spacing.md, gap: 4 },
  faqQ: { ...typography.label, fontSize: 15, color: palette.textPrimary },
  faqA: { ...typography.bodySmall, fontSize: 13, color: palette.textSecondary, lineHeight: 19 },

  footer: { ...typography.bodySmall, color: palette.textDisabled, fontSize: 12, textAlign: 'center', marginTop: spacing.sm },
});
