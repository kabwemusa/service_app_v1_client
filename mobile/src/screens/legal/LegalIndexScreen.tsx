import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LegalDocumentMeta, LegalDocumentType, legalApi } from '../../api/legal';
import { DraftBanner } from '../../components/legal/DraftBanner';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { palette, radius as r, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<LegalDocumentType, IconName> = {
  terms_of_service: 'document-text-outline',
  privacy_policy: 'lock-closed-outline',
  user_agreement: 'create-outline',
};

/**
 * Profile → Legal / About. Lists the three versioned documents, always available
 * (not only at signup), with the version + effective date shown.
 */
export default function LegalIndexScreen({ navigation }: any) {
  const [docs, setDocs] = useState<LegalDocumentMeta[]>([]);
  const [draftMode, setDraftMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let alive = true;
    legalApi
      .listDocuments()
      .then((res) => {
        if (!alive) return;
        setDocs(res.documents);
        setDraftMode(res.draft_mode);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScreenHeader title="Legal & policies" back />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          <DraftBanner draftMode={draftMode} />
          <Text style={styles.blurb}>
            These are the agreements between you and Sebenza Technologies Ltd. They
            are available here any time.
          </Text>

          <View style={styles.card}>
            {docs.map((d, i) => (
              <React.Fragment key={d.type}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableRipple
                  onPress={() => navigation.navigate('LegalDocument', { type: d.type })}
                  borderless
                  accessibilityRole="button"
                  accessibilityLabel={d.title}
                >
                  <View style={styles.row}>
                    <View style={styles.iconChip}>
                      <Ionicons name={ICONS[d.type]} size={18} color={palette.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>{d.title}</Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        Version {d.version}
                        {d.effective_date ? ` · Effective ${d.effective_date}` : ' · Draft'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
                  </View>
                </TouchableRipple>
              </React.Fragment>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  blurb: { ...typography.bodySmall, color: palette.textSecondary, marginBottom: spacing.md },
  card: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, paddingVertical: spacing.sm },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: r.sm,
    backgroundColor: palette.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { ...typography.body, fontSize: 16, color: palette.textPrimary },
  rowSub: { ...typography.bodySmall, fontSize: 12, color: palette.textSecondary, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginLeft: 38 + spacing.md },
});
