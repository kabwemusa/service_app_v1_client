import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Chip, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useCategoryStore } from '../../store/categoryStore';
import { useSearchStore } from '../../store/searchStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

const RADIUS_OPTIONS = [2, 5, 10] as const;

export default function SearchScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();

  const [query, setQuery]         = useState('');
  const [radiusKm, setRadiusKm]   = useState<number>(5);
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [locationReady, setLocationReady] = useState(false);
  const [locLoading, setLocLoading]       = useState(true);

  const latRef = useRef<number | null>(null);
  const lngRef = useRef<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { categories, fetchCategories } = useCategoryStore();
  const { results, loading, error, total, search, loadMore, clearError, reset } = useSearchStore();
  const { showError } = useSnackbar();

  // ── Location ───────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchCategories();

    (async () => {
      setLocLoading(true);
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        showError('Location permission denied. Using default location.');
        // Lusaka CBD fallback
        latRef.current = -15.4166;
        lngRef.current =  28.2833;
        setLocationReady(true);
        setLocLoading(false);
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      latRef.current = loc.coords.latitude;
      lngRef.current = loc.coords.longitude;
      setLocationReady(true);
      setLocLoading(false);
    })();

    return () => {
      reset();
    };
  }, []);

  // ── Run search whenever location, radius, or category changes ─────────────
  useEffect(() => {
    if (!locationReady) return;
    runSearch(query);
  }, [locationReady, radiusKm, categoryId]);

  // ── Debounced keyword search ───────────────────────────────────────────────
  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (locationReady) runSearch(text);
    }, 400);
  };

  const runSearch = useCallback(
    (q: string) => {
      if (latRef.current === null || lngRef.current === null) return;
      search({
        query:       q.trim() || undefined,
        lat:         latRef.current,
        lng:         lngRef.current,
        radius_km:   radiusKm,
        category_id: categoryId,
        page:        1,
      });
    },
    [radiusKm, categoryId, search],
  );

  // ── Error handling ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderSkeleton = () => (
    <View style={styles.skeletons}>
      {[1, 2, 3, 4, 5].map((k) => <CardSkeleton key={k} />)}
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.empty}>
      <MaterialCommunityIcons name="map-search-outline" size={52} color={palette.textDisabled} />
      <Text style={styles.emptyTitle}>No services found</Text>
      <Text style={styles.emptyText}>
        Try a different keyword, category, or expand the radius.
      </Text>
    </View>
  );

  const renderFooter = () => {
    if (!loading || results.length === 0) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={palette.primary} size="small" />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <MaterialCommunityIcons
          name="magnify"
          size={20}
          color={palette.textSecondary}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search services…"
          placeholderTextColor={palette.textDisabled}
          value={query}
          onChangeText={handleQueryChange}
          returnKeyType="search"
          onSubmitEditing={() => {
            Keyboard.dismiss();
            if (locationReady) runSearch(query);
          }}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              setQuery('');
              if (locationReady) runSearch('');
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="close-circle" size={18} color={palette.textDisabled} />
          </TouchableOpacity>
        )}
        {locLoading && (
          <ActivityIndicator
            size="small"
            color={palette.primary}
            style={{ marginLeft: spacing.xs }}
          />
        )}
      </View>

      {/* Radius chips */}
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Radius</Text>
        {RADIUS_OPTIONS.map((km) => (
          <Chip
            key={km}
            selected={radiusKm === km}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setRadiusKm(km);
            }}
            style={[styles.chip, radiusKm === km && styles.chipSelected]}
            textStyle={[styles.chipText, radiusKm === km && styles.chipTextSelected]}
            showSelectedCheck={false}
          >
            {km} km
          </Chip>
        ))}
      </View>

      {/* Category chips */}
      <FlashList
        data={[{ id: undefined as number | undefined, name: 'All' }, ...categories]}
        keyExtractor={(item) => String(item.id ?? 'all')}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.catChips}
        renderItem={({ item }) => (
          <Chip
            selected={categoryId === item.id}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setCategoryId(item.id);
            }}
            style={[styles.chip, categoryId === item.id && styles.chipSelected]}
            textStyle={[styles.chipText, categoryId === item.id && styles.chipTextSelected]}
            showSelectedCheck={false}
          >
            {item.name}
          </Chip>
        )}
      />

      {/* Results count */}
      {!loading && results.length > 0 && (
        <Text style={styles.resultCount}>{total} result{total !== 1 ? 's' : ''} nearby</Text>
      )}

      {/* Main list */}
      {loading && results.length === 0 ? (
        renderSkeleton()
      ) : (
        <FlashList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 110, paddingHorizontal: spacing.lg }}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          onRefresh={() => locationReady && runSearch(query)}
          refreshing={loading && results.length === 0}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          renderItem={({ item }) => (
            <TouchableRipple
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                navigation.navigate('ServiceDetail', { serviceId: item.id });
              }}
              borderless
              style={styles.card}
            >
              <View style={styles.cardInner}>
                <View style={styles.cardLeft}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.cardCategory}>{item.category.name}</Text>

                  <View style={styles.metaRow}>
                    <MaterialCommunityIcons name="star" size={13} color={palette.warning} />
                    <Text style={styles.metaText}>
                      {item.provider.r_bayes.toFixed(1)} ({item.provider.v_reviews})
                    </Text>
                    <Text style={styles.dot}>·</Text>
                    <MaterialCommunityIcons name="map-marker-outline" size={13} color={palette.textSecondary} />
                    <Text style={styles.metaText}>{item.distance_km} km</Text>
                  </View>

                  {/* Tap provider name to open ProviderProfileScreen */}
                  <TouchableRipple
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      navigation.navigate('ProviderProfile', { providerId: item.provider_id });
                    }}
                    style={styles.providerPill}
                    borderless
                  >
                    <Text style={styles.providerText} numberOfLines={1}>
                      View provider profile →
                    </Text>
                  </TouchableRipple>
                </View>

                <View style={styles.cardRight}>
                  <Text style={styles.price}>ZMW {item.base_price.toFixed(0)}</Text>
                  <View style={styles.badgeRow}>
                    {item.has_promo_slot && (
                      <View style={[styles.badge, styles.promoBadge]}>
                        <Text style={styles.badgeText}>AD</Text>
                      </View>
                    )}
                    <TierBadge tier={item.provider.trust_tier} />
                  </View>
                </View>
              </View>
            </TouchableRipple>
          )}
        />
      )}
    </SafeAreaView>
  );
}

// ── Trust-tier badge ──────────────────────────────────────────────────────────
function TierBadge({ tier }: { tier: number }) {
  const config = tier >= 4
    ? { label: 'Elite',    bg: '#7C3AED' }
    : tier === 3
    ? { label: 'Pro',      bg: palette.success }
    : tier === 2
    ? { label: 'Verified', bg: palette.primary }
    : tier === 1
    ? { label: 'Basic',    bg: palette.textSecondary }
    : { label: 'New',      bg: palette.textDisabled };

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={styles.badgeText}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  searchBar: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  palette.surface,
    borderRadius:     r.lg,
    borderWidth:      1,
    borderColor:      palette.border,
    marginHorizontal: spacing.lg,
    marginTop:        spacing.md,
    marginBottom:     spacing.sm,
    paddingHorizontal: spacing.md,
    height:           48,
    ...shadow.card,
  },
  searchIcon:  { marginRight: spacing.xs },
  searchInput: {
    flex:            1,
    fontFamily:      'PlusJakartaSans_400Regular',
    fontSize:        15,
    color:           palette.textPrimary,
    paddingVertical: 0,
  },

  filterRow: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: spacing.lg,
    marginBottom:     spacing.xs,
    gap:              spacing.xs,
  },
  filterLabel: {
    ...typography.label,
    color:        palette.textSecondary,
    marginRight:  spacing.xs,
    fontSize:     12,
  },

  catChips: {
    paddingHorizontal: spacing.lg,
    paddingBottom:     spacing.sm,
    gap:               spacing.xs,
  },

  chip: {
    backgroundColor: palette.surface,
    borderWidth:     1,
    borderColor:     palette.border,
    borderRadius:    r.full,
    height:          34,
  },
  chipSelected:     { backgroundColor: palette.primary, borderColor: palette.primary },
  chipText:         { ...typography.bodySmall, color: palette.textSecondary, fontSize: 13 },
  chipTextSelected: { color: '#FFFFFF' },

  resultCount: {
    ...typography.bodySmall,
    color:           palette.textSecondary,
    paddingHorizontal: spacing.lg,
    marginBottom:    spacing.xs,
  },

  skeletons: { paddingHorizontal: spacing.lg, gap: spacing.xs },

  card: {
    backgroundColor: palette.surface,
    borderRadius:    r.lg,
    borderWidth:     1,
    borderColor:     palette.border,
    marginBottom:    spacing.sm,
    overflow:        'hidden',
    ...shadow.card,
  },
  cardInner: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    padding:         spacing.md,
    gap:             spacing.sm,
  },
  cardLeft:    { flex: 1 },
  cardRight:   { alignItems: 'flex-end', justifyContent: 'space-between', minWidth: 80 },
  cardTitle:   { ...typography.label, color: palette.textPrimary, fontSize: 15, marginBottom: 2 },
  cardCategory:{ ...typography.bodySmall, color: palette.textSecondary, marginBottom: spacing.xs },

  metaRow:  { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.xs },
  metaText: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },
  dot:      { color: palette.textDisabled },

  providerPill:  { alignSelf: 'flex-start', paddingVertical: 2 },
  providerText:  { ...typography.bodySmall, color: palette.primary, fontSize: 12 },

  price: { ...typography.label, color: palette.primary, fontSize: 16, marginBottom: spacing.xs },

  badgeRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' },
  badge: {
    borderRadius:    r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  promoBadge: { backgroundColor: '#F59E0B' },
  badgeText: {
    fontFamily:  'PlusJakartaSans_700Bold',
    fontSize:    10,
    color:       '#FFFFFF',
    letterSpacing: 0.5,
  },

  footer: { paddingVertical: spacing.md, alignItems: 'center' },

  empty: {
    alignItems:      'center',
    paddingVertical: spacing.xxl * 1.5,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    ...typography.heading3,
    color:      palette.textPrimary,
    marginTop:  spacing.md,
    marginBottom: spacing.xs,
  },
  emptyText: {
    ...typography.body,
    color:     palette.textSecondary,
    textAlign: 'center',
  },
});
