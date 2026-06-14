import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrowseServiceCard } from '../../components/browse/BrowseServiceCard';
import { FiltersSheet } from '../../components/browse/FiltersSheet';
import { SortSheet } from '../../components/browse/SortSheet';
import { LocationPickerSheet } from '../../components/location/LocationPickerSheet';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { SearchParams, SearchResult } from '../../api/search';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useCategoryStore } from '../../store/categoryStore';
import { useLocationStore } from '../../store/locationStore';
import { useSearchStore } from '../../store/searchStore';
import { useRecentSearchStore } from '../../store/recentSearchStore';
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  FilterState,
  SortOption,
  useBrowseStore,
} from '../../store/browseStore';
import { palette, radius as r, spacing } from '../../theme';
import { fontFamily } from '../../theme/typography';

// ── Sort label ────────────────────────────────────────────────────────────────

const SORT_LABELS: Record<SortOption, string> = {
  recommended: 'Recommended',
  top_rated:   'Top rated',
  price_asc:   'Price ↑',
  fastest:     'Fastest',
  nearest:     'Nearest',
};

// ── Build search params from filter/sort state ────────────────────────────────

function buildParams(
  filters:       FilterState,
  sort:          SortOption,
  categoryId:    number | undefined,
  subCategoryId: number | undefined,
  lat:           number | undefined,
  lng:           number | undefined,
  region:        string | null | undefined,
  query:         string,
  page:          number,
): SearchParams {
  const params: SearchParams = { sort, page };
  // Sub-category selection (refine row) overrides the parent category_id
  const effectiveCategoryId = subCategoryId ?? categoryId;
  if (effectiveCategoryId)  params.category_id = effectiveCategoryId;
  if (lat && lng)           { params.lat = lat; params.lng = lng; }
  // Promoted-slot inventory is matched per category × region (v3.2 §1.5)
  if (region)               params.region = region;
  if (query.trim())     params.query = query.trim();

  if (filters.maxBudget !== null)      params.max_price  = filters.maxBudget;
  if (filters.availability !== 'any') {
    params.availability = filters.availability;
    if (filters.availability === 'date' && filters.availabilityDate) {
      params.availability_date = filters.availabilityDate;
    }
  }
  if (filters.verifiedId)              params.verified_id = true;
  if (filters.topRated)                params.top_rated   = true;
  if (filters.minTier > 0)             params.min_tier    = filters.minTier;
  if (filters.languages.length > 0)   params.languages   = filters.languages.join(',');

  return params;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function BrowseScreen({ navigation, route }: any) {
  const initialCategoryId    = route.params?.categoryId    as number | undefined;
  const initialQuery         = route.params?.q             as string | undefined;
  // Sub-category selected from the refine chip row
  const [subCategoryId, setSubCategoryId] = useState<number | undefined>(undefined);

  const insets               = useSafeAreaInsets();
  const { categories }       = useCategoryStore();
  const { primaryLocation, setPrimary } = useLocationStore();
  const { results, loading, total, loadMore, search, resolvedCategory } = useSearchStore();
  const { showError }        = useSnackbar();
  const { push: pushRecent } = useRecentSearchStore();

  // Category key for per-category filter/sort persistence
  // Use 'q:{query}' when in free-text mode so filters don't bleed into category browse
  const categoryKey  = initialCategoryId != null
    ? String(initialCategoryId)
    : initialQuery
    ? `q:${initialQuery}`
    : 'all';

  const categoryName = useMemo(() => {
    if (initialCategoryId != null) {
      return categories.find((c) => c.id === initialCategoryId)?.name ?? 'Services';
    }
    return initialQuery ? `"${initialQuery}"` : 'Services';
  }, [categories, initialCategoryId, initialQuery]);

  const { setFilter, setSort, resetFilters, activeCount } = useBrowseStore();

  // Stable selectors — avoids new object reference every render (would cause infinite effect loop)
  const filters = useBrowseStore((s) => s.filters[categoryKey] ?? DEFAULT_FILTERS);
  const sort    = useBrowseStore((s) => s.sorts[categoryKey]   ?? DEFAULT_SORT);

  // Saved-service IDs — optimistic local state (API not yet available)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // UI state
  const [query,           setQuery]           = useState(initialQuery ?? '');
  const [filtersVisible,  setFiltersVisible]  = useState(false);
  const [sortVisible,     setSortVisible]     = useState(false);
  const [locationVisible, setLocationVisible] = useState(false);
  const [isOffline,       setIsOffline]       = useState(false);

  const queryDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Search executor ───────────────────────────────────────────────────────

  const runSearch = useCallback(
    (page = 1, reset = true) => {
      const params = buildParams(
        filters, sort,
        initialCategoryId,
        subCategoryId,
        primaryLocation?.lat, primaryLocation?.lng,
        primaryLocation?.region,
        query, page,
      );
      if (reset && query.trim()) pushRecent(query.trim());
      search(params, reset).catch((e: any) => {
        if (e?.message?.toLowerCase().includes('network')) {
          setIsOffline(true);
        } else {
          showError(e?.message ?? 'Could not load services.');
        }
      });
      setIsOffline(false);
    },
    [filters, sort, initialCategoryId, subCategoryId, primaryLocation, query, search, showError, pushRecent],
  );

  // Re-run when filter/sort/location/subcategory changes
  useEffect(() => {
    runSearch(1, true);
  }, [filters, sort, primaryLocation, initialCategoryId, subCategoryId]);

  // Debounce in-category search query
  useEffect(() => {
    if (queryDebounce.current) clearTimeout(queryDebounce.current);
    queryDebounce.current = setTimeout(() => runSearch(1, true), 350);
    return () => { if (queryDebounce.current) clearTimeout(queryDebounce.current); };
  }, [query]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleApplyFilters = (f: FilterState) => {
    setFilter(categoryKey, f);
  };

  const handleApplySort = (s: SortOption) => {
    setSort(categoryKey, s);
  };

  const handleToggleQuickFilter = (field: 'verifiedId' | 'topRated' | 'availability') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (field === 'availability') {
      setFilter(categoryKey, {
        availability: filters.availability === 'today' ? 'any' : 'today',
      });
    } else {
      setFilter(categoryKey, { [field]: !filters[field] });
    }
  };

  const handleSave = (id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleEndReached = useCallback(() => {
    loadMore();
  }, [loadMore]);

  // ── Chip row state ────────────────────────────────────────────────────────

  const filterCount = activeCount(categoryKey);

  // ── Location label ────────────────────────────────────────────────────────

  const handlePrimarySelect = useCallback(
    async (loc: { lat: number; lng: number; label: string; region: string | null; source: 'DEVICE' | 'SEARCH' | 'SAVED' }) => {
      const ok = await setPrimary(loc);
      if (!ok) showError('Could not update your location.');
    },
    [setPrimary, showError],
  );

  const locationLabel = primaryLocation?.label ?? 'Set location';

  // ── Result count subtitle ─────────────────────────────────────────────────

  const resultLine = loading && results.length === 0
    ? 'Loading…'
    : primaryLocation
    ? `${total} service${total === 1 ? '' : 's'} near ${locationLabel}`
    : `${total} service${total === 1 ? '' : 's'}`;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>

      {/* ── Fixed header ─────────────────────────────────────────── */}
      <View style={styles.headerArea}>

        {/* Row 1: back + search bar (free-text mode) OR title (category mode) + location pill */}
        <View style={styles.topRow}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back" size={22} color={palette.textPrimary} />
          </TouchableOpacity>

          {initialQuery != null ? (
            /* Free-text mode — tappable query bar returns to autocomplete */
            <TouchableOpacity
              style={styles.queryBar}
              onPress={() => navigation.goBack()}
              accessibilityLabel={`Search: ${query}. Tap to edit`}
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Ionicons name="search-outline" size={14} color={palette.textSecondary} />
              <Text style={styles.queryBarTxt} numberOfLines={1}>{query || initialQuery}</Text>
              <Ionicons name="close-circle" size={14} color={palette.textDisabled} />
            </TouchableOpacity>
          ) : (
            <Text style={styles.categoryTitle} numberOfLines={1}>{categoryName}</Text>
          )}

          {/* Compact delivery-location pill */}
          <TouchableRipple
            style={styles.locationPill}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setLocationVisible(true);
            }}
            rippleColor="rgba(123,26,58,0.08)"
            accessibilityLabel={`Delivery location: ${locationLabel}`}
            accessibilityRole="button"
          >
            <View style={styles.locationPillInner}>
              <Ionicons
                name={primaryLocation ? 'location' : 'location-outline'}
                size={13}
                color={primaryLocation ? palette.primary : palette.textSecondary}
              />
              <Text style={styles.locationPillTxt} numberOfLines={1}>{locationLabel}</Text>
              <Ionicons name="chevron-down" size={12} color={palette.textSecondary} />
            </View>
          </TouchableRipple>
        </View>

        {/* Row 2: in-category keyword search — only shown in category-browse mode */}
        {initialQuery == null && (
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={16} color={palette.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder={`Search in ${categoryName}…`}
              placeholderTextColor={palette.textDisabled}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              accessibilityLabel={`Search in ${categoryName}`}
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={16} color={palette.textDisabled} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Refine chip row — only when a resolved parent category has children */}
        {resolvedCategory != null && resolvedCategory.children.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.refineRow}
          >
            <TouchableOpacity
              style={[styles.chip, subCategoryId == null && styles.chipActive]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSubCategoryId(undefined); }}
              accessibilityRole="radio"
              accessibilityState={{ checked: subCategoryId == null }}
            >
              <Text style={[styles.chipTxt, subCategoryId == null && styles.chipTxtActive]}>
                All {resolvedCategory.name}
              </Text>
            </TouchableOpacity>
            {resolvedCategory.children.map((child) => (
              <TouchableOpacity
                key={child.id}
                style={[styles.chip, subCategoryId === child.id && styles.chipActive]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSubCategoryId(child.id); }}
                accessibilityRole="radio"
                accessibilityState={{ checked: subCategoryId === child.id }}
                accessibilityLabel={child.name}
              >
                {child.icon ? (
                  <Ionicons name={child.icon as any} size={13} color={subCategoryId === child.id ? palette.primary : palette.textPrimary} />
                ) : null}
                <Text style={[styles.chipTxt, subCategoryId === child.id && styles.chipTxtActive]}>
                  {child.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Row 3: sticky chip row — horizontal scroll on narrow devices */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {/* Sort chip */}
          <TouchableOpacity
            style={styles.chip}
            onPress={() => setSortVisible(true)}
            accessibilityLabel={`Sort: ${SORT_LABELS[sort]}`}
            accessibilityRole="button"
          >
            <Ionicons name="swap-vertical-outline" size={14} color={palette.textPrimary} />
            <Text style={styles.chipTxt}>Sort: {SORT_LABELS[sort]}</Text>
          </TouchableOpacity>

          {/* Filters chip with active count badge */}
          <TouchableOpacity
            style={[styles.chip, filterCount > 0 && styles.chipActive]}
            onPress={() => setFiltersVisible(true)}
            accessibilityLabel={`Filters${filterCount > 0 ? `, ${filterCount} active` : ''}`}
            accessibilityRole="button"
          >
            <Ionicons
              name="options-outline"
              size={14}
              color={filterCount > 0 ? palette.primary : palette.textPrimary}
            />
            <Text style={[styles.chipTxt, filterCount > 0 && styles.chipTxtActive]}>
              Filters
            </Text>
            {filterCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeTxt}>{filterCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Quick toggles — mirror the sheet's state (single source of truth) */}
          <TouchableOpacity
            style={[styles.chip, filters.availability === 'today' && styles.chipActive]}
            onPress={() => handleToggleQuickFilter('availability')}
            accessibilityRole="button"
            accessibilityLabel="Available today"
            accessibilityState={{ checked: filters.availability === 'today' }}
          >
            <Text style={[styles.chipTxt, filters.availability === 'today' && styles.chipTxtActive]}>
              Today
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.chip, filters.verifiedId && styles.chipActive]}
            onPress={() => handleToggleQuickFilter('verifiedId')}
            accessibilityRole="button"
            accessibilityLabel="Verified providers only"
            accessibilityState={{ checked: filters.verifiedId }}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={13}
              color={filters.verifiedId ? palette.primary : palette.textPrimary}
            />
            <Text style={[styles.chipTxt, filters.verifiedId && styles.chipTxtActive]}>
              Verified
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.chip, filters.topRated && styles.chipActive]}
            onPress={() => handleToggleQuickFilter('topRated')}
            accessibilityRole="button"
            accessibilityLabel="Top rated only"
            accessibilityState={{ checked: filters.topRated }}
          >
            <Ionicons
              name="star-outline"
              size={13}
              color={filters.topRated ? palette.primary : palette.textPrimary}
            />
            <Text style={[styles.chipTxt, filters.topRated && styles.chipTxtActive]}>
              Top rated
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Row 4: result count */}
        <View style={styles.resultRow}>
          <Text style={styles.resultTxt}>{resultLine}</Text>
          {sort === 'recommended' && !loading && total > 0 && (
            <View style={styles.bestMatchBadge}>
              <Ionicons name="sparkles" size={11} color={palette.primary} />
              <Text style={styles.bestMatchTxt}>best match</Text>
            </View>
          )}
        </View>

        {/* Offline notice */}
        {isOffline && results.length > 0 && (
          <View style={styles.offlineBar}>
            <Ionicons name="cloud-offline-outline" size={14} color={palette.warning} />
            <Text style={styles.offlineTxt}>Offline — showing cached results</Text>
          </View>
        )}
      </View>

      {/* ── Card list ─────────────────────────────────────────────── */}
      {loading && results.length === 0 ? (
        <View style={styles.skeletons}>
          {[1, 2, 3, 4].map((k) => (
            <CardSkeleton key={k} style={styles.skeleton} />
          ))}
        </View>
      ) : results.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={44} color={palette.textDisabled} />
          <Text style={styles.emptyTitle}>
            {primaryLocation ? `No services near ${locationLabel}` : 'No services found'}
          </Text>
          <Text style={styles.emptyBody}>
            {filterCount > 0
              ? 'Try loosening your filters or changing location.'
              : "We couldn't find matching services yet."}
          </Text>
          <View style={styles.emptyActions}>
            {filterCount > 0 && (
              <TouchableRipple
                onPress={() => resetFilters(categoryKey)}
                style={styles.emptyAction}
                borderless
              >
                <Text style={styles.emptyActionTxt}>Clear filters</Text>
              </TouchableRipple>
            )}
            <TouchableRipple
              onPress={() => setLocationVisible(true)}
              style={[styles.emptyAction, styles.emptyActionOutline]}
              borderless
            >
              <Text style={styles.emptyActionTxtOutline}>Change location</Text>
            </TouchableRipple>
          </View>
        </View>
      ) : (
        <FlatList<SearchResult>
          data={results}
          keyExtractor={(item) => item.id}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop:        spacing.sm,
            paddingBottom:     insets.bottom + 112,
          }}
          renderItem={({ item }) => (
            <BrowseServiceCard
              data={item}
              saved={savedIds.has(item.id)}
              onPress={() => navigation.navigate('ServiceDetail', { serviceId: item.id })}
              onSave={() => handleSave(item.id)}
            />
          )}
          ListFooterComponent={
            <View style={styles.footer}>
              <Ionicons name="location-outline" size={14} color={palette.textDisabled} />
              <Text style={styles.footerTxt}>
                Ranked for your location automatically — no distance to set.
              </Text>
            </View>
          }
        />
      )}

      {/* ── Sheets ───────────────────────────────────────────────── */}
      <FiltersSheet
        visible={filtersVisible}
        initial={filters}
        categoryId={initialCategoryId}
        primaryLocation={primaryLocation}
        onApply={handleApplyFilters}
        onClose={() => setFiltersVisible(false)}
      />

      <SortSheet
        visible={sortVisible}
        current={sort}
        onSelect={handleApplySort}
        onClose={() => setSortVisible(false)}
      />

      <LocationPickerSheet
        visible={locationVisible}
        onClose={() => setLocationVisible(false)}
        onSelect={handlePrimarySelect}
        title="Show services near"
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  // ── Header area ───────────────────────────────────────────────
  headerArea: {
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    paddingHorizontal: spacing.lg,
    paddingBottom:     spacing.sm,
  },

  // Top row: back + title + location pill
  topRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            spacing.sm,
    paddingTop:     spacing.sm,
    marginBottom:   spacing.sm,
  },
  backBtn: {
    width:          44,
    height:         44,
    alignItems:     'center',
    justifyContent: 'center',
    marginLeft:     -spacing.sm,
  },
  categoryTitle: {
    fontFamily: fontFamily.medium,
    fontSize:   18,
    color:      palette.textPrimary,
    flex:       1,
  },

  // Compact location pill
  locationPill: {
    borderRadius:    r.full,
    overflow:        'hidden',
    borderWidth:     1,
    borderColor:     palette.border,
    backgroundColor: palette.background,
    maxWidth:        140,
  },
  locationPillInner: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.sm,
    paddingVertical:   spacing.xs + 2,
    gap:               4,
    minHeight:         34,
  },
  locationPillTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   12,
    color:      palette.textSecondary,
    flex:       1,
  },

  // Free-text mode: tappable query bar in the top row
  queryBar: {
    flex:              1,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    backgroundColor:   palette.background,
    borderRadius:      r.xl,
    borderWidth:       1,
    borderColor:       palette.border,
    paddingHorizontal: spacing.md,
    height:            38,
  },
  queryBarTxt: {
    flex:       1,
    fontFamily: fontFamily.regular,
    fontSize:   14,
    color:      palette.textPrimary,
  },

  // Refine chip row (sub-categories of resolved parent)
  refineRow: {
    flexDirection: 'row',
    gap:           spacing.xs,
    marginBottom:  spacing.sm,
    paddingRight:  spacing.lg,
  },

  // Search bar
  searchBar: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   palette.background,
    borderRadius:      r.xl,
    borderWidth:       1,
    borderColor:       palette.border,
    paddingHorizontal: spacing.md,
    height:            44,
    gap:               spacing.sm,
    marginBottom:      spacing.sm,
  },
  searchInput: {
    flex:       1,
    fontFamily: fontFamily.regular,
    fontSize:   14,
    color:      palette.textPrimary,
    paddingVertical: 0,
  },

  // Chip row (horizontal scroll)
  chipRow: {
    flexDirection: 'row',
    gap:           spacing.xs,
    marginBottom:  spacing.sm,
    paddingRight:  spacing.lg,
  },
  chip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    borderWidth:       1,
    borderColor:       palette.border,
    borderRadius:      r.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical:   spacing.xs + 2,
    backgroundColor:   palette.surface,
    minHeight:         34,
  },
  chipActive: {
    backgroundColor: palette.primaryLight,
    borderColor:     palette.primary,
  },
  chipTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   13,
    color:      palette.textPrimary,
  },
  chipTxtActive: {
    fontFamily: fontFamily.medium,
    color:      palette.primary,
  },

  // Filter count badge
  badge: {
    width:           18,
    height:          18,
    borderRadius:    9,
    backgroundColor: palette.primary,
    alignItems:      'center',
    justifyContent:  'center',
    marginLeft:      2,
  },
  badgeTxt: {
    fontFamily: fontFamily.medium,
    fontSize:   10,
    color:      '#fff',
  },

  // Result count row
  resultRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            spacing.xs,
  },
  resultTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   13,
    color:      palette.textSecondary,
    flex:       1,
  },
  bestMatchBadge: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    backgroundColor:   palette.primaryLight,
    borderRadius:      r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical:   3,
  },
  bestMatchTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   11,
    color:      palette.primary,
  },

  // Offline notice
  offlineBar: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing.xs,
    backgroundColor: palette.warningLight,
    borderRadius:    r.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop:       spacing.xs,
  },
  offlineTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   12,
    color:      palette.warning,
  },

  // Skeletons
  skeletons: {
    paddingHorizontal: spacing.lg,
    paddingTop:        spacing.sm,
    gap:               spacing.sm,
  },
  skeleton: { height: 112, borderRadius: r.lg },

  // Empty state
  emptyState: {
    flex:              1,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: spacing.xl,
    gap:               spacing.sm,
  },
  emptyTitle: {
    fontFamily: fontFamily.medium,
    fontSize:   16,
    color:      palette.textPrimary,
    textAlign:  'center',
    marginTop:  spacing.sm,
  },
  emptyBody: {
    fontFamily: fontFamily.regular,
    fontSize:   14,
    color:      palette.textSecondary,
    textAlign:  'center',
    lineHeight: 21,
  },
  emptyActions: {
    flexDirection: 'row',
    gap:           spacing.sm,
    marginTop:     spacing.sm,
  },
  emptyAction: {
    backgroundColor:   palette.primary,
    borderRadius:      r.full,
    paddingHorizontal: spacing.lg,
    paddingVertical:   spacing.sm,
    minHeight:         44,
    justifyContent:    'center',
  },
  emptyActionOutline: {
    backgroundColor: 'transparent',
    borderWidth:     1,
    borderColor:     palette.primary,
  },
  emptyActionTxt:        { fontFamily: fontFamily.medium, fontSize: 14, color: '#fff' },
  emptyActionTxtOutline: { fontFamily: fontFamily.medium, fontSize: 14, color: palette.primary },

  // List footer
  footer: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             spacing.xs,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  footerTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   12,
    color:      palette.textDisabled,
    textAlign:  'center',
    flex:       1,
  },
});
