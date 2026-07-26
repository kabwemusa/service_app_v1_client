import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Category,
  FlatCategory,
  categoriesApi,
  flattenTaxonomy,
  matchesQuery,
} from '../../api/categories';
import { palette, radius as r, shadow, spacing } from '../../theme';
import { fontFamily } from '../../theme/typography';

/**
 * Reusable category picker — the same pattern across app, PWA and admin:
 *   • a small set of POPULAR (most-used) categories as quick-tap chips, and
 *   • a SEARCHABLE picker over the FULL taxonomy (matches name + synonyms +
 *     parent group), type-ahead + debounced, results virtualized (FlatList).
 *
 * The taxonomy is fetched from the ONE shared source (/categories) — never a
 * hardcoded list. Opens as a bottom-sheet on mobile.
 */
interface Props {
  visible:    boolean;
  selectedId: number | null;
  onSelect:   (category: FlatCategory) => void;
  onClose:    () => void;
}

export function CategoryPicker({ visible, selectedId, onSelect, onClose }: Props) {
  const [tree, setTree]       = useState<Category[]>([]);
  const [popular, setPopular] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [raw, setRaw]         = useState('');
  const [query, setQuery]     = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Fetch the shared taxonomy + popular set once when first opened.
  useEffect(() => {
    if (!visible || tree.length > 0) return;
    setLoading(true);
    Promise.all([categoriesApi.list(), categoriesApi.popular()])
      .then(([all, pop]) => { setTree(all); setPopular(pop); })
      .catch(() => { /* surfaced by the empty state below */ })
      .finally(() => setLoading(false));
  }, [visible]);

  // Debounced type-ahead (250ms) — keyboard-friendly.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQuery(raw), 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [raw]);

  const flat = useMemo(() => flattenTaxonomy(tree), [tree]);
  const results = useMemo(
    () => flat.filter((c) => matchesQuery(c, query)),
    [flat, query],
  );

  const choose = (c: FlatCategory) => {
    setRaw(''); setQuery('');
    onSelect(c);
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close category picker" accessibilityRole="button" />
        <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={{ width: 28 }} />
              <Text style={styles.headerTitle}>Choose a category</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={palette.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Search field */}
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={18} color={palette.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search categories…"
                placeholderTextColor={palette.textDisabled}
                value={raw}
                onChangeText={setRaw}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search categories"
              />
              {raw !== '' && (
                <TouchableOpacity onPress={() => setRaw('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={18} color={palette.textDisabled} />
                </TouchableOpacity>
              )}
            </View>

            {/* Popular chips — quick tap, shown until the user types */}
            {query === '' && popular.length > 0 && (
              <View style={styles.popularWrap}>
                <Text style={styles.sectionLabel}>Popular</Text>
                <View style={styles.chipRow}>
                  {popular.map((c) => {
                    const selected = c.id === selectedId;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => choose({ id: c.id, name: c.name, parent_id: c.parent_id, parent_name: null, synonyms: c.synonyms ?? [], icon: c.icon })}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{c.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Full-taxonomy results (virtualized) */}
            {loading ? (
              <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.primary} />
            ) : (
              <FlatList
                data={results}
                keyExtractor={(c) => String(c.id)}
                keyboardShouldPersistTaps="handled"
                style={styles.list}
                initialNumToRender={20}
                maxToRenderPerBatch={20}
                windowSize={10}
                ListHeaderComponent={query !== '' ? <Text style={styles.sectionLabel}>Results</Text> : null}
                ListEmptyComponent={<Text style={styles.empty}>No categories match “{query}”.</Text>}
                renderItem={({ item }) => {
                  const selected = item.id === selectedId;
                  return (
                    <TouchableOpacity style={styles.row} onPress={() => choose(item)} accessibilityRole="button" accessibilityState={{ selected }}>
                      <View style={styles.rowBody}>
                        <Text style={[styles.rowName, selected && styles.rowNameSelected]}>{item.name}</Text>
                        {item.parent_name && <Text style={styles.rowParent}>{item.parent_name}</Text>}
                      </View>
                      {selected && <Ionicons name="checkmark-circle" size={20} color={palette.primary} />}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root:     { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheetWrap: { backgroundColor: palette.surface, borderTopLeftRadius: r.xl, borderTopRightRadius: r.xl, maxHeight: '85%' },
  sheet:     { backgroundColor: palette.surface, borderTopLeftRadius: r.xl, borderTopRightRadius: r.xl, ...shadow.modal },
  handle:    { alignSelf: 'center', width: 36, height: 4, borderRadius: r.full, backgroundColor: palette.border, marginTop: spacing.sm },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 4, borderBottomWidth: 1, borderBottomColor: palette.border },
  headerTitle: { fontFamily: fontFamily.medium, fontSize: 16, color: palette.textPrimary },
  closeBtn:  { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginHorizontal: spacing.lg, marginTop: spacing.md, paddingHorizontal: spacing.sm + 2, height: 44, borderWidth: 1, borderColor: palette.border, borderRadius: r.md, backgroundColor: palette.background },
  searchInput: { flex: 1, fontFamily: fontFamily.regular, fontSize: 15, color: palette.textPrimary },

  popularWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
  sectionLabel: { fontFamily: fontFamily.medium, fontSize: 12, color: palette.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.xs, paddingHorizontal: spacing.lg },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: r.full, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  chipSelected: { backgroundColor: palette.primaryLight, borderColor: palette.primary },
  chipText: { fontFamily: fontFamily.regular, fontSize: 13, color: palette.textPrimary },
  chipTextSelected: { color: palette.primary, fontFamily: fontFamily.medium },

  list: { marginTop: spacing.md, paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2, borderBottomWidth: 1, borderBottomColor: palette.border, minHeight: 48 },
  rowBody: { flex: 1 },
  rowName: { fontFamily: fontFamily.regular, fontSize: 15, color: palette.textPrimary },
  rowNameSelected: { color: palette.primary, fontFamily: fontFamily.medium },
  rowParent: { fontFamily: fontFamily.regular, fontSize: 12, color: palette.textSecondary, marginTop: 1 },
  empty: { fontFamily: fontFamily.regular, fontSize: 14, color: palette.textSecondary, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
});
