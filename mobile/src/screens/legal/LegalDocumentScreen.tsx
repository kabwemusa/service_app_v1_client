import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LegalDocument, LegalDocumentType, legalApi } from '../../api/legal';
import { LegalDocumentView } from '../../components/legal/LegalDocumentView';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { palette, spacing, typography } from '../../theme';

/**
 * Reads one versioned legal document (Terms / Privacy / User Agreement) from the
 * shared content source — accessible any time from Profile → Legal, not only at
 * signup. Route param: { type }.
 */
export default function LegalDocumentScreen({ route }: any) {
  const type = route.params?.type as LegalDocumentType;
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    legalApi
      .getDocument(type)
      .then((d) => alive && setDoc(d))
      .catch(() => alive && setError('Could not load this document. Please try again.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [type]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScreenHeader title={doc?.title ?? 'Legal'} back />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : error || !doc ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error ?? 'Document unavailable.'}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xxl }]}
          showsVerticalScrollIndicator={false}
        >
          <LegalDocumentView doc={doc} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  error: { ...typography.body, color: palette.textSecondary, textAlign: 'center' },
});
