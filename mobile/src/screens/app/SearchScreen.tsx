import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocationPickerSheet } from '../../components/location/LocationPickerSheet';
import {
  MatchCandidate,
  MatchResponse,
  Suggestion,
  SuggestResult,
  matchApi,
  searchApi,
} from '../../api/search';
import { useCategoryStore } from '../../store/categoryStore';
import { useLocationStore } from '../../store/locationStore';
import { useRecentSearchStore } from '../../store/recentSearchStore';
import { palette, radius as r, spacing } from '../../theme';
import { fontFamily } from '../../theme/typography';

// ── Highlight matched substring ───────────────────────────────────────────────

function HighlightedLabel({
  label,
  span,
  style,
  highlightStyle,
}: {
  label:          string;
  span?:          [number, number] | null;
  style:          object;
  highlightStyle: object;
}) {
  if (!span) return <Text style={style}>{label}</Text>;
  const [start, end] = span;
  return (
    <Text style={style}>
      {label.slice(0, start)}
      <Text style={highlightStyle}>{label.slice(start, end)}</Text>
      {label.slice(end)}
    </Text>
  );
}

// ── Suggestion row ────────────────────────────────────────────────────────────

function SuggestionRow({
  item,
  onPress,
}: {
  item:    Suggestion;
  onPress: () => void;
}) {
  const isProvider = item.type === 'provider';
  const isCategory = item.type === 'category';

  return (
    <TouchableRipple
      onPress={onPress}
      style={styles.suggRow}
      accessibilityRole="button"
      accessibilityLabel={`${item.label}, ${item.subtitle}`}
    >
      <View style={styles.suggInner}>
        {/* Icon / avatar */}
        {isProvider ? (
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarTxt}>{item.initials ?? '?'}</Text>
          </View>
        ) : (
          <View style={[styles.iconCircle, isCategory && styles.iconCircleCategory]}>
            <Ionicons
              name={(item.icon as any) ?? (isCategory ? 'grid-outline' : 'search-outline')}
              size={16}
              color={isCategory ? palette.primary : palette.textSecondary}
            />
          </View>
        )}

        {/* Text */}
        <View style={styles.suggText}>
          <HighlightedLabel
            label={item.label}
            span={item.match_span}
            style={styles.suggLabel}
            highlightStyle={styles.suggLabelBold}
          />
          <Text style={styles.suggSub} numberOfLines={1}>{item.subtitle}</Text>
        </View>

        <Ionicons name="arrow-forward-outline" size={14} color={palette.textDisabled} />
      </View>
    </TouchableRipple>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SearchScreen({ navigation }: any) {
  const insets  = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const [query,          setQuery]          = useState('');
  const [result,         setResult]         = useState<SuggestResult | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [pickerVisible,  setPickerVisible]  = useState(false);
  const [activeIndex,    setActiveIndex]    = useState(-1);  // keyboard nav
  // Full-pipeline match result (submit only). clarify/empty render inline; a
  // matched result navigates straight to the ranked results screen.
  const [matchState,     setMatchState]     = useState<MatchResponse | null>(null);
  const [matching,       setMatching]       = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef    = useRef<AbortController | null>(null);

  const { categories, fetchCategories } = useCategoryStore();
  const { primaryLocation, setPrimary } = useLocationStore();
  const { recents, hydrated, hydrate, push: pushRecent, remove: removeRecent } = useRecentSearchStore();

  useEffect(() => {
    fetchCategories();
    hydrate();
    // Focus the input after mount
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // ── Debounced suggest call ───────────────────────────────────────────────

  const runSuggest = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (q.trim().length < 1) {
        setResult(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      debounceRef.current = setTimeout(async () => {
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        try {
          const data = await searchApi.suggest(
            q,
            primaryLocation?.lat,
            primaryLocation?.lng,
          );
          setResult(data);
          setActiveIndex(-1);
          // Announce count for screen readers
          AccessibilityInfo.announceForAccessibility(
            `${data.suggestions.length} suggestion${data.suggestions.length !== 1 ? 's' : ''} found`,
          );
        } catch {
          // Cancelled or network — silently ignore
        } finally {
          setLoading(false);
        }
      }, 200);
    },
    [primaryLocation],
  );

  const handleQueryChange = (text: string) => {
    setQuery(text);
    setMatchState(null); // editing dismisses the previous match panel
    runSuggest(text);
  };

  const handleClear = () => {
    setQuery('');
    setResult(null);
    setMatchState(null);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  // ── Navigation helpers ───────────────────────────────────────────────────

  const navigateToResults = useCallback(
    (params: { q?: string; categoryId?: number; resolvedCategoryId?: number | null }) => {
      if (params.q) pushRecent(params.q);
      navigation.navigate('BrowseMain', params);
    },
    [navigation, pushRecent],
  );

  const handleSuggestionPress = useCallback(
    (item: Suggestion) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      switch (item.type) {
        case 'category':
          navigateToResults({ categoryId: item.id as number });
          break;
        case 'service':
          navigation.navigate('ServiceDetail', { serviceId: item.id });
          break;
        case 'provider':
          navigation.navigate('ProviderProfile', { providerId: item.id });
          break;
        default:
          navigateToResults({
            q: item.label,
            resolvedCategoryId: result?.resolved_category?.id ?? null,
          });
      }
    },
    [navigation, navigateToResults, result],
  );

  // Submit runs the FULL pipeline (matchServices). A confident match navigates
  // straight to the ranked real services; ambiguous → inline clarify; nothing →
  // honest empty. The LLM layer only ever runs here, never during type-ahead.
  const handleSubmit = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    inputRef.current?.blur();
    setMatching(true);
    setMatchState(null);
    try {
      const m = await matchApi.match({
        query: q,
        lat: primaryLocation?.lat,
        lng: primaryLocation?.lng,
        region: primaryLocation?.region ?? undefined,
      });
      pushRecent(q);

      if (m.status === 'matched' || m.status === 'matched_no_supply') {
        // Real ranked services — hand the matched set to the results screen.
        navigation.navigate(
          'BrowseMain',
          m.resolved_category ? { categoryId: m.resolved_category.id } : { q },
        );
        return;
      }

      // clarify | empty → render inline (asking beats guessing wrong).
      setMatchState(m);
    } catch {
      // Matcher unavailable — fall back to a plain keyword browse.
      navigateToResults({ q });
    } finally {
      setMatching(false);
    }
  }, [query, primaryLocation, navigation, pushRecent, navigateToResults]);

  const handleCandidate = useCallback(
    (c: MatchCandidate) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (c.type === 'service') {
        navigation.navigate('ServiceDetail', { serviceId: c.id });
      } else if (c.category_id != null) {
        navigateToResults({ categoryId: c.category_id });
      }
    },
    [navigation, navigateToResults],
  );

  const handleRecentPress = (q: string) => {
    setQuery(q);
    runSuggest(q);
  };

  const handlePrimarySelect = useCallback(
    async (loc: { lat: number; lng: number; label: string; region: string | null; source: 'DEVICE' | 'SEARCH' | 'SAVED' }) => {
      await setPrimary(loc);
    },
    [setPrimary],
  );

  // ── Popular categories (from store, first 8) ─────────────────────────────

  const popularCategories = categories.slice(0, 8);

  // ── Empty-query state ────────────────────────────────────────────────────

  const showEmptyState = query.trim().length === 0;
  const showNoMatch    = !loading && query.trim().length > 0 && result?.suggestions.length === 0;
  const suggestions    = result?.suggestions ?? [];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Search bar ──────────────────────────────────────────────── */}
      <View style={styles.searchRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color={palette.textPrimary} />
        </TouchableOpacity>

        <View
          style={styles.inputWrap}
          accessible
          accessibilityRole="combobox"
          accessibilityLabel="Search services"
          accessibilityState={{ expanded: suggestions.length > 0 }}
        >
          <Ionicons name="search-outline" size={16} color={palette.textSecondary} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search services…"
            placeholderTextColor={palette.textDisabled}
            value={query}
            onChangeText={handleQueryChange}
            returnKeyType="search"
            onSubmitEditing={handleSubmit}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search services"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={handleClear}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
            >
              <Ionicons name="close-circle" size={16} color={palette.textDisabled} />
            </TouchableOpacity>
          )}
          {(loading || matching) && (
            <View style={styles.loadingDot} />
          )}
        </View>
      </View>

      {/* ── Location context line ────────────────────────────────────── */}
      <TouchableRipple
        onPress={() => setPickerVisible(true)}
        style={styles.locationRow}
        accessibilityLabel={`Searching near ${primaryLocation?.label ?? 'no location set'}. Tap to change`}
        accessibilityRole="button"
      >
        <View style={styles.locationRowInner}>
          <Ionicons
            name={primaryLocation ? 'location' : 'location-outline'}
            size={13}
            color={primaryLocation ? palette.primary : palette.textSecondary}
          />
          <Text style={styles.locationTxt} numberOfLines={1}>
            {primaryLocation
              ? `Searching near ${primaryLocation.label}`
              : 'Set your location'}
          </Text>
          <Ionicons name="chevron-down" size={12} color={palette.textSecondary} />
        </View>
      </TouchableRipple>

      {/* ── Match panel (submit result: clarify / honest-empty) ─────── */}
      {matchState && (
        <View style={styles.matchCard}>
          {matchState.status === 'clarify' ? (
            <>
              <Text style={styles.matchTitle}>Did you mean…</Text>
              <View style={styles.matchChips}>
                {matchState.candidates.map((c) => (
                  <TouchableOpacity
                    key={c.ref}
                    style={styles.matchChip}
                    onPress={() => handleCandidate(c)}
                    accessibilityRole="button"
                    accessibilityLabel={c.label}
                  >
                    <Text style={styles.matchChipTxt}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity onPress={() => navigateToResults({ q: query })}>
                <Text style={styles.matchBrowse}>None of these — browse all</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Ionicons name="search-outline" size={32} color={palette.textDisabled} />
              <Text style={styles.matchTitle}>We don't have "{matchState.query}" yet</Text>
              {matchState.closest_categories.length > 0 && (
                <>
                  <Text style={styles.matchBody}>The closest we have:</Text>
                  <View style={styles.matchChips}>
                    {matchState.closest_categories.map((cc) => (
                      <TouchableOpacity
                        key={cc.id}
                        style={styles.matchChip}
                        onPress={() => navigateToResults({ categoryId: cc.id })}
                        accessibilityRole="button"
                        accessibilityLabel={cc.name}
                      >
                        <Text style={styles.matchChipTxt}>{cc.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <TouchableOpacity onPress={() => navigateToResults({ q: query })}>
                <Text style={styles.matchBrowse}>Browse all services</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* ── Suggestions list (when query ≥ 1 char) ──────────────────── */}
      {!showEmptyState && !matchState && (
        <FlatList
          data={suggestions}
          keyExtractor={(item, i) => `${item.type}-${item.id}-${i}`}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 84 }}
          renderItem={({ item }) => (
            <SuggestionRow
              item={item}
              onPress={() => handleSuggestionPress(item)}
            />
          )}
          ListEmptyComponent={
            showNoMatch ? (
              <View style={styles.noMatch}>
                <Ionicons name="search-outline" size={36} color={palette.textDisabled} />
                <Text style={styles.noMatchTitle}>No results for "{query}"</Text>
                <Text style={styles.noMatchBody}>
                  Try a different term or browse popular categories below.
                </Text>
                <View style={styles.noMatchCats}>
                  {popularCategories.map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={styles.noMatchChip}
                      onPress={() => navigateToResults({ categoryId: cat.id })}
                    >
                      <Text style={styles.noMatchChipTxt}>{cat.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null
          }
        />
      )}

      {/* ── Empty-query state: recents + popular categories ─────────── */}
      {showEmptyState && (
        <FlatList
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 84 }}
          data={[]}
          renderItem={null}
          ListHeaderComponent={
            <>
              {/* Recent searches */}
              {hydrated && recents.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Recent</Text>
                    <TouchableOpacity
                      onPress={() => useRecentSearchStore.getState().clear()}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.clearAll}>Clear all</Text>
                    </TouchableOpacity>
                  </View>
                  {recents.map((r) => (
                    <TouchableRipple
                      key={r.query}
                      onPress={() => handleRecentPress(r.query)}
                      style={styles.recentRow}
                    >
                      <View style={styles.recentInner}>
                        <Ionicons name="time-outline" size={16} color={palette.textSecondary} />
                        <Text style={styles.recentTxt} numberOfLines={1}>{r.query}</Text>
                        <TouchableOpacity
                          onPress={() => removeRecent(r.query)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityLabel={`Remove ${r.query} from recent searches`}
                        >
                          <Ionicons name="close" size={14} color={palette.textDisabled} />
                        </TouchableOpacity>
                      </View>
                    </TouchableRipple>
                  ))}
                </View>
              )}

              {/* Popular categories */}
              {popularCategories.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Popular categories</Text>
                  <View style={styles.catGrid}>
                    {popularCategories.map((cat) => (
                      <TouchableRipple
                        key={cat.id}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          navigateToResults({ categoryId: cat.id });
                        }}
                        style={styles.catChip}
                        borderless
                      >
                        <View style={styles.catChipInner}>
                          <Ionicons
                            name={(cat.icon as any) ?? 'grid-outline'}
                            size={14}
                            color={palette.primary}
                          />
                          <Text style={styles.catChipTxt} numberOfLines={1}>{cat.name}</Text>
                        </View>
                      </TouchableRipple>
                    ))}
                  </View>
                </View>
              )}
            </>
          }
        />
      )}

      <LocationPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handlePrimarySelect}
        title="Search near"
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  // Search bar row
  searchRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    gap:               spacing.xs,
    backgroundColor:   palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  backBtn: {
    width:          40,
    height:         40,
    alignItems:     'center',
    justifyContent: 'center',
  },
  inputWrap: {
    flex:              1,
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   palette.background,
    borderRadius:      r.xl,
    borderWidth:       1,
    borderColor:       palette.border,
    paddingHorizontal: spacing.md,
    height:            44,
    gap:               spacing.xs,
  },
  input: {
    flex:            1,
    fontFamily:      fontFamily.regular,
    fontSize:        15,
    color:           palette.textPrimary,
    paddingVertical: 0,
  },
  loadingDot: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: palette.primary,
    opacity:         0.6,
  },

  // Location line
  locationRow: {
    marginHorizontal: spacing.lg,
    marginTop:        spacing.xs + 2,
    marginBottom:     spacing.xs,
    alignSelf:        'flex-start',
    borderRadius:     r.full,
  },
  locationRowInner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    paddingHorizontal: spacing.sm,
    paddingVertical:   spacing.xs,
    backgroundColor:   palette.primaryLight,
    borderRadius:      r.full,
  },
  locationTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   12,
    color:      palette.primary,
    maxWidth:   220,
  },

  // Suggestion rows
  suggRow: { paddingHorizontal: spacing.lg },
  suggInner: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    minHeight:       52,
  },
  iconCircle: {
    width:           36,
    height:          36,
    borderRadius:    r.full,
    backgroundColor: palette.background,
    borderWidth:     1,
    borderColor:     palette.border,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  iconCircleCategory: {
    backgroundColor: palette.primaryLight,
    borderColor:     palette.primary,
  },
  avatarCircle: {
    width:           36,
    height:          36,
    borderRadius:    r.full,
    backgroundColor: palette.primaryLight,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  avatarTxt: {
    fontFamily: fontFamily.medium,
    fontSize:   13,
    color:      palette.primary,
  },
  suggText:      { flex: 1 },
  suggLabel:     { fontFamily: fontFamily.regular, fontSize: 15, color: palette.textPrimary },
  suggLabelBold: { fontFamily: fontFamily.medium },
  suggSub:       { fontFamily: fontFamily.regular, fontSize: 12, color: palette.textSecondary, marginTop: 1 },

  // Match panel (clarify / honest-empty)
  matchCard: {
    alignItems:        'center',
    paddingHorizontal: spacing.xl,
    paddingTop:        spacing.xl,
    gap:               spacing.sm,
  },
  matchTitle: {
    fontFamily: fontFamily.medium,
    fontSize:   16,
    color:      palette.textPrimary,
    textAlign:  'center',
  },
  matchBody: {
    fontFamily: fontFamily.regular,
    fontSize:   13,
    color:      palette.textSecondary,
    textAlign:  'center',
  },
  matchChips: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    gap:            spacing.xs,
    justifyContent: 'center',
    marginTop:      spacing.xs,
  },
  matchChip: {
    borderRadius:      r.full,
    borderWidth:       1,
    borderColor:       palette.primary,
    backgroundColor:   palette.primaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.xs + 2,
  },
  matchChipTxt: {
    fontFamily: fontFamily.medium,
    fontSize:   14,
    color:      palette.primary,
  },
  matchBrowse: {
    fontFamily: fontFamily.regular,
    fontSize:   13,
    color:      palette.textSecondary,
    marginTop:  spacing.sm,
    textDecorationLine: 'underline',
  },

  // No-match state
  noMatch: {
    alignItems:        'center',
    paddingHorizontal: spacing.xl,
    paddingTop:        spacing.xxl,
    gap:               spacing.sm,
  },
  noMatchTitle: {
    fontFamily: fontFamily.medium,
    fontSize:   16,
    color:      palette.textPrimary,
    textAlign:  'center',
    marginTop:  spacing.sm,
  },
  noMatchBody: {
    fontFamily: fontFamily.regular,
    fontSize:   13,
    color:      palette.textSecondary,
    textAlign:  'center',
    lineHeight: 19,
  },
  noMatchCats: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           spacing.xs,
    marginTop:     spacing.sm,
    justifyContent: 'center',
  },
  noMatchChip: {
    borderRadius:      r.full,
    borderWidth:       1,
    borderColor:       palette.border,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.xs + 2,
    backgroundColor:   palette.surface,
  },
  noMatchChipTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   13,
    color:      palette.textSecondary,
  },

  // Empty-query state sections
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop:        spacing.md,
  },
  sectionHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   spacing.xs,
  },
  sectionTitle: {
    fontFamily:   fontFamily.medium,
    fontSize:     13,
    color:        palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom:  spacing.xs,
  },
  clearAll: {
    fontFamily: fontFamily.regular,
    fontSize:   12,
    color:      palette.primary,
  },

  // Recent rows
  recentRow: { borderRadius: r.sm },
  recentInner: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing.sm,
    paddingVertical: spacing.sm + 2,
    minHeight:       44,
  },
  recentTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   14,
    color:      palette.textPrimary,
    flex:       1,
  },

  // Popular category chips
  catGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           spacing.xs,
  },
  catChip: {
    borderRadius:    r.full,
    overflow:        'hidden',
  },
  catChipInner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing.xs,
    borderRadius:      r.full,
    borderWidth:       1,
    borderColor:       palette.border,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.xs + 2,
    backgroundColor:   palette.surface,
    minHeight:         36,
  },
  catChipTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   13,
    color:      palette.textSecondary,
  },
});
