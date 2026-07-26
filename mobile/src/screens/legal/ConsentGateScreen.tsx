import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Switch, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LegalDocumentMeta, LegalDocumentType, legalApi } from '../../api/legal';
import { DraftBanner } from '../../components/legal/DraftBanner';
import { useConsentStore } from '../../store/consentStore';
import { palette, radius as r, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const DOC_ICON: Record<LegalDocumentType, IconName> = {
  terms_of_service: 'document-text-outline',
  privacy_policy: 'lock-closed-outline',
  user_agreement: 'create-outline',
};

/**
 * The CONSENT GATE (brief §A). Shown after phone verification and BEFORE the user
 * can use the app. Consent here is:
 *   • informed  — the full documents are one tap away and must be readable;
 *   • distinguishable — the required agreement is a distinct, explicit tick;
 *   • unbundled — optional marketing / analytics are SEPARATE toggles, OFF by
 *     default, never pre-ticked, and the user can accept without them;
 *   • freely given — Decline is offered plainly, with no dark patterns.
 *
 * ACCEPT → records versioned consent → the gate clears.
 * DECLINE → records the decline → a respectful block (ConsentDeclinedScreen).
 */
export default function ConsentGateScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { status, submitting, accept, decline, error } = useConsentStore();

  const [docs, setDocs] = useState<LegalDocumentMeta[]>([]);
  const [draftMode, setDraftMode] = useState(false);
  const [docsLoading, setDocsLoading] = useState(true);

  // Required agreement is UNTICKED until the user affirmatively agrees.
  const [agreedRequired, setAgreedRequired] = useState(false);
  // Optional processing — OFF by default (no pre-ticking).
  const [marketing, setMarketing] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  const reconsent = status?.reason === 'VERSION_CHANGE';

  useEffect(() => {
    let alive = true;
    legalApi
      .listDocuments()
      .then((res) => {
        if (!alive) return;
        setDocs(res.documents);
        setDraftMode(res.draft_mode);
      })
      .finally(() => alive && setDocsLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const onAccept = async () => {
    if (!agreedRequired) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await accept({ marketing, analytics });
    // On success the store flips needs_consent=false and App.tsx unmounts the gate.
  };

  const onDecline = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await decline();
    // Store sets phase='declined' → App.tsx renders ConsentDeclinedScreen.
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 160 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.iconBadge}>
            <Ionicons name="shield-checkmark" size={26} color={palette.primary} />
          </View>
          <Text style={styles.heading}>
            {reconsent ? 'We’ve updated our agreements' : 'Before you start'}
          </Text>
          <Text style={styles.subheading}>
            {reconsent
              ? 'We’ve made changes to the documents below. Please review and agree to continue.'
              : 'Please review the agreements below. You choose what you agree to — some things are optional.'}
          </Text>
        </View>

        <DraftBanner draftMode={draftMode} />

        {/* Read the documents */}
        <Text style={styles.groupLabel}>The agreements</Text>
        <View style={styles.card}>
          {docsLoading ? (
            <View style={styles.docLoading}>
              <ActivityIndicator color={palette.primary} />
            </View>
          ) : (
            docs.map((d, i) => (
              <React.Fragment key={d.type}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableRipple
                  onPress={() => navigation.navigate('LegalDocument', { type: d.type })}
                  borderless
                  accessibilityRole="button"
                  accessibilityLabel={`Read ${d.title}`}
                >
                  <View style={styles.row}>
                    <View style={styles.iconChip}>
                      <Ionicons name={DOC_ICON[d.type]} size={18} color={palette.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>{d.title}</Text>
                      <Text style={styles.rowSub}>Tap to read · v{d.version}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
                  </View>
                </TouchableRipple>
              </React.Fragment>
            ))
          )}
        </View>

        {/* Required consent — a distinct, explicit, un-ticked agreement */}
        <TouchableRipple
          onPress={() => setAgreedRequired((v) => !v)}
          borderless={false}
          style={styles.consentBox}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreedRequired }}
          accessibilityLabel="Agree to the Terms of Service, User Agreement, and core Privacy Policy processing"
        >
          <View style={styles.consentRow}>
            <View style={[styles.checkbox, agreedRequired && styles.checkboxOn]}>
              {agreedRequired && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
            </View>
            <Text style={styles.consentText}>
              I have read and agree to the{' '}
              <Text style={styles.link}>Terms of Service</Text> and{' '}
              <Text style={styles.link}>User Agreement</Text>, and I consent to the
              core processing described in the{' '}
              <Text style={styles.link}>Privacy Policy</Text> that is needed to
              provide Sebenza (identity verification, booking and payment).
            </Text>
          </View>
        </TouchableRipple>

        {/* Optional processing — unbundled, OFF by default */}
        <Text style={styles.groupLabel}>Optional — you can use Sebenza without these</Text>
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Marketing messages</Text>
              <Text style={styles.rowSub}>
                Offers and news by SMS, WhatsApp or email. Off unless you turn it on.
              </Text>
            </View>
            <Switch
              value={marketing}
              onValueChange={setMarketing}
              color={palette.primary}
              accessibilityLabel="Marketing messages"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Non-essential analytics</Text>
              <Text style={styles.rowSub}>
                Helps us improve the app. Not needed to use Sebenza.
              </Text>
            </View>
            <Switch
              value={analytics}
              onValueChange={setAnalytics}
              color={palette.primary}
              accessibilityLabel="Non-essential analytics"
            />
          </View>
        </View>

        {!!error && <Text style={styles.error}>{error.message}</Text>}
      </ScrollView>

      {/* Sticky action bar */}
      <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TouchableRipple
          style={[styles.acceptBtn, (!agreedRequired || submitting) && styles.btnDisabled]}
          onPress={onAccept}
          disabled={!agreedRequired || submitting}
          borderless
          accessibilityRole="button"
          accessibilityLabel="Agree and continue"
        >
          {submitting ? (
            <ActivityIndicator size={18} color="#FFFFFF" />
          ) : (
            <Text style={styles.acceptText}>Agree &amp; continue</Text>
          )}
        </TouchableRipple>
        <TouchableRipple
          style={styles.declineBtn}
          onPress={onDecline}
          disabled={submitting}
          borderless
          accessibilityRole="button"
          accessibilityLabel="Decline"
        >
          <Text style={styles.declineText}>Decline</Text>
        </TouchableRipple>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  hero: { alignItems: 'center', marginBottom: spacing.lg },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heading: {
    ...typography.heading2,
    fontSize: 24,
    color: palette.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subheading: {
    ...typography.body,
    fontSize: 15,
    color: palette.textSecondary,
    textAlign: 'center',
    maxWidth: 360,
  },

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
  docLoading: { paddingVertical: spacing.lg, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
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

  consentBox: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: palette.textDisabled,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: palette.primary, borderColor: palette.primary },
  consentText: { ...typography.bodySmall, fontSize: 14, lineHeight: 20, color: palette.textPrimary, flex: 1 },
  link: { color: palette.primary, fontFamily: 'DMSans_600SemiBold' },

  error: { ...typography.bodySmall, color: palette.danger, marginTop: spacing.md, textAlign: 'center' },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  acceptBtn: {
    height: 52,
    borderRadius: r.sm,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: { ...typography.label, fontSize: 16, color: '#FFFFFF' },
  btnDisabled: { opacity: 0.5 },
  declineBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  declineText: { ...typography.label, fontSize: 14, color: palette.textSecondary },
});
