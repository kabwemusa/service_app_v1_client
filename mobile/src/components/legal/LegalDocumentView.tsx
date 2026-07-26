import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Text, TextInput } from 'react-native-paper';
import { LegalDocument } from '../../api/legal';
import { palette, radius as r, spacing, typography } from '../../theme';
import { DraftBanner } from './DraftBanner';

/**
 * Renders one versioned legal document: header (title, version, effective date),
 * the DRAFT banner when applicable, an optional in-document search filter, and
 * anchored sections. Plain, readable typography; light + dark inherit from the
 * palette. Used by the standalone document screen and (compactly) by the gate.
 */
export function LegalDocumentView({
  doc,
  searchable = true,
}: {
  doc: LegalDocument;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return doc.content.sections;
    return doc.content.sections.filter(
      (s) => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q),
    );
  }, [doc, query]);

  const effective =
    doc.effective_date
      ? `Effective ${doc.effective_date}`
      : 'Effective date set on publication';

  return (
    <View>
      {/* Header */}
      <Text style={styles.title}>{doc.title}</Text>
      <Text style={styles.meta}>
        Version {doc.version} · {effective}
        {doc.last_updated ? ` · Updated ${doc.last_updated}` : ''}
      </Text>

      <DraftBanner draftMode={doc.draft_mode} />

      {!!doc.content.intro && (
        <Markdown style={mdStyles as any}>{doc.content.intro}</Markdown>
      )}

      {searchable && doc.content.sections.length > 4 && (
        <TextInput
          mode="outlined"
          dense
          placeholder="Search this document"
          value={query}
          onChangeText={setQuery}
          style={styles.search}
          outlineStyle={{ borderRadius: r.sm }}
          left={<TextInput.Icon icon="magnify" />}
          right={
            query
              ? <TextInput.Icon icon="close" onPress={() => setQuery('')} />
              : undefined
          }
        />
      )}

      {sections.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={20} color={palette.textDisabled} />
          <Text style={styles.emptyText}>No sections match “{query}”.</Text>
        </View>
      ) : (
        sections.map((s) => (
          // `nativeID` acts as the section anchor for deep-linking / TOC.
          <View key={s.id} nativeID={s.id} style={styles.section}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <Markdown style={mdStyles as any}>{s.body}</Markdown>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.heading2, color: palette.textPrimary },
  meta: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  search: { backgroundColor: palette.surface, marginBottom: spacing.md },
  section: {
    marginBottom: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  sectionTitle: {
    ...typography.heading3,
    fontSize: 17,
    color: palette.textPrimary,
    marginBottom: spacing.xs,
  },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyText: { ...typography.bodySmall, color: palette.textSecondary },
});

// Markdown theming mapped onto the design tokens (no external fonts/colors).
const mdStyles = {
  body: {
    ...typography.body,
    color: palette.textPrimary,
    fontSize: 15,
    lineHeight: 23,
  },
  paragraph: { marginTop: 0, marginBottom: spacing.sm },
  strong: { fontFamily: 'DMSans_700Bold', color: palette.textPrimary },
  em: { fontFamily: 'DMSans_400Regular', fontStyle: 'italic', color: palette.textSecondary },
  bullet_list: { marginBottom: spacing.sm },
  ordered_list: { marginBottom: spacing.sm },
  list_item: { marginBottom: 2 },
  heading2: { ...typography.heading3, color: palette.textPrimary, marginTop: spacing.sm },
  link: { color: palette.primary },
};
