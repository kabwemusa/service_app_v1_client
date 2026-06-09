import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { BookingSheet } from '../../components/booking/BookingSheet';
import { LocationPickerSheet } from '../../components/location/LocationPickerSheet';
import { HomeBannerCarousel } from '../../components/discovery/HomeBannerCarousel';
import { ServiceDiscoveryCard } from '../../components/discovery/ServiceDiscoveryCard';
import { ApiError } from '../../api/errors';
import { bookingsApi, MyProvider } from '../../api/bookings';
import { searchApi, SearchResult } from '../../api/search';
import { Service } from '../../api/services';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useAuthStore } from '../../store/authStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useLocationStore } from '../../store/locationStore';
import { palette, radius as r, spacing } from '../../theme';
import { fontFamily } from '../../theme/typography';

// ── Constants ────────────────────────────────────────────────────────────────

const SCREEN_W = Dimensions.get('window').width;
// Tile width for the 2-column category grid
const TILE_W   = Math.floor((SCREEN_W - 2 * spacing.lg - spacing.sm) / 2);

// Deterministic palette — rotates by category.id so new categories always get a colour
const CAT_PALETTE = [
  '#0891B2', '#2563EB', '#7C3AED', '#D97706',
  '#DB2777', '#16A34A', '#4B5563', '#0369A1',
  '#15803D', '#B45309', '#1D4ED8', '#1E40AF',
  '#92400E', '#9D174D',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function toBookableService(r: SearchResult): Service {
  return {
    id:                     r.id,
    provider_id:            r.provider_id,
    category_id:            r.category.id,
    category:               { ...r.category, icon_url: null },
    title:                  r.title,
    description:            r.description,
    pricing_model:          r.pricing_model,
    base_price:             r.base_price,
    duration_estimate_mins: null,
    status:                 'ACTIVE',
    is_pinned:              false,
    latitude:               r.latitude,
    longitude:              r.longitude,
    distance_km:            r.distance_km,
    provider:               r.provider,
    inclusions:             [],
    addons:                 [],
    photos:                 [],
    created_at:             '',
  };
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation }: any) {
  const { categories, fetchCategories, loading: cLoading } = useCategoryStore();
  const { activeDelivery, setActiveDelivery }              = useLocationStore();
  const { showError, showSnackbar }                        = useSnackbar();
  const user       = useAuthStore((s) => s.user);
  const activeRole = useAuthStore((s) => s.activeRole);
  const insets = useSafeAreaInsets();

  const [results, setResults]             = useState<SearchResult[]>([]);
  const [loading, setLoading]             = useState(false);
  const [myProviders, setMyProviders]     = useState<MyProvider[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [bookingService, setBookingService] = useState<Service | null>(null);

  useEffect(() => {
    fetchCategories();
  }, []);

  // Fetch "Your providers" from completed booking history — silent fail
  useEffect(() => {
    if (!user || activeRole !== 'CUSTOMER') return;
    bookingsApi
      .myProviders()
      .then(setMyProviders)
      .catch(() => {});
  }, [user?.id, activeRole]);

  const runDiscovery = useCallback(async () => {
    setLoading(true);
    try {
      const res = await searchApi.search({
        ...(activeDelivery ? { lat: activeDelivery.lat, lng: activeDelivery.lng } : {}),
        page: 1,
      });
      setResults(res.data);
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Could not load services.');
    } finally {
      setLoading(false);
    }
  }, [activeDelivery]);

  useEffect(() => {
    runDiscovery();
  }, [activeDelivery]);

  const handleCategoryPress = (categoryId: number) => {
    navigation.navigate('BrowseMain', { categoryId });
  };

  const handleBookPress = useCallback(
    (result: SearchResult) => {
      if (result.pricing_model === 'QUOTE') {
        showSnackbar({
          message: 'Quote requests coming soon — the provider will send you a custom price.',
          variant: 'info',
        });
        return;
      }
      setBookingService(toBookableService(result));
    },
    [showSnackbar],
  );

  const handleBooked = useCallback(
    (bookingId: string) => {
      setBookingService(null);
      navigation.navigate('Bookings', { screen: 'BookingDetail', params: { bookingId } });
    },
    [navigation],
  );

  const handleBannerAction = useCallback(
    (action: string) => {
      // Simple router: "Search?q=cleaning" → navigate to Search with query
      if (action.startsWith('Search')) {
        navigation.navigate('Search');
      }
    },
    [navigation],
  );

  const sectionLabel = activeDelivery
    ? `Top rated near ${activeDelivery.label}`
    : 'Explore services';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 112 }]}
      >
        {/* ── Top bar ────────────────────────────────────────────────── */}
        <View style={styles.topBar}>
          <Text style={styles.brand}>sebenza</Text>
          <View style={styles.topBarActions}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setPickerVisible(true);
              }}
              accessibilityLabel={activeDelivery ? `Location: ${activeDelivery.label}` : 'Set delivery location'}
              accessibilityRole="button"
            >
              <Ionicons
                name={activeDelivery ? 'location' : 'location-outline'}
                size={20}
                color={activeDelivery ? palette.primary : palette.textPrimary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              accessibilityLabel="Notifications"
              accessibilityRole="button"
            >
              <Ionicons name="notifications-outline" size={20} color={palette.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Greeting + headline ────────────────────────────────────── */}
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.headline}>Find trusted help{'\n'}near you</Text>

        {/* ── Promo carousel (data-driven, collapses when empty) ─────── */}
        {/* Negative margins cancel the parent's paddingHorizontal so slides
            run edge-to-edge; content inside each slide is re-padded. */}
        <View style={styles.carouselWrap}>
          <HomeBannerCarousel onAction={handleBannerAction} />
        </View>

        {/* ── Categories ─────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Categories</Text>
          <TouchableRipple
            onPress={() => navigation.navigate('Search')}
            style={styles.seeAllBtn}
            borderless
          >
            <Text style={styles.seeAll}>See all</Text>
          </TouchableRipple>
        </View>

        {cLoading && categories.length === 0 ? (
          <View style={styles.catSkeletonGrid}>
            {[1, 2, 3, 4].map((k) => (
              <View key={k} style={[styles.catSkeleton, { width: TILE_W }]} />
            ))}
          </View>
        ) : (
          // 2-column wrap grid — all categories visible without horizontal scroll
          <View style={styles.categoryGrid}>
            {categories.map((cat) => {
              const iconColor = CAT_PALETTE[cat.id % CAT_PALETTE.length];
              return (
                <TouchableRipple
                  key={cat.id}
                  onPress={() => handleCategoryPress(cat.id)}
                  rippleColor={`${iconColor}18`}
                  style={[styles.categoryTile, { width: TILE_W }]}
                >
                  <View style={styles.categoryTileInner}>
                    <View style={[styles.catIconCircle, { backgroundColor: `${iconColor}18` }]}>
                      <Ionicons
                        name={(cat.icon ?? 'grid-outline') as React.ComponentProps<typeof Ionicons>['name']}
                        size={16}
                        color={iconColor}
                      />
                    </View>
                    <Text style={styles.catName} numberOfLines={2}>
                      {cat.name}
                    </Text>
                  </View>
                </TouchableRipple>
              );
            })}
          </View>
        )}

        {/* ── Your providers (hidden when list is empty) ─────────────── */}
        {myProviders.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Your providers</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.providerShelf}
            >
              {myProviders.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.providerChip}
                  onPress={() => navigation.navigate('ServiceDetail', { providerId: p.id })}
                  activeOpacity={0.75}
                >
                  <View style={styles.providerChipAvatar}>
                    <Text style={styles.providerChipInitial}>
                      {(p.display_name || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.providerChipName} numberOfLines={2}>
                    {p.display_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {/* ── Discovery section ─────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <TouchableRipple
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setPickerVisible(true);
            }}
            borderless
            style={styles.sectionTitleBtn}
          >
            <View style={styles.sectionTitleInner}>
              <Text style={styles.sectionTitle} numberOfLines={1}>
                {sectionLabel}
              </Text>
              <Ionicons name="chevron-down" size={15} color={palette.textSecondary} />
            </View>
          </TouchableRipple>
          <TouchableRipple
            onPress={() => navigation.navigate('Search')}
            borderless
            style={styles.seeAllBtn}
          >
            <Text style={styles.seeAll}>See all</Text>
          </TouchableRipple>
        </View>

        {/* Soft location nudge — informational, never blocks the feed */}
        {!activeDelivery && (
          <TouchableRipple
            onPress={() => setPickerVisible(true)}
            style={styles.locationNudge}
            rippleColor="rgba(123,26,58,0.06)"
          >
            <View style={styles.locationNudgeInner}>
              <Ionicons name="location-outline" size={14} color={palette.primary} />
              <Text style={styles.locationNudgeText}>
                Set your location to see providers near you
              </Text>
              <Ionicons name="chevron-forward" size={14} color={palette.primary} />
            </View>
          </TouchableRipple>
        )}

        {/* Cards / skeleton / empty state */}
        {loading && results.length === 0 ? (
          [1, 2, 3].map((k) => (
            <CardSkeleton key={k} style={styles.cardSkeleton} />
          ))
        ) : results.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={40} color={palette.textDisabled} />
            <Text style={styles.emptyTitle}>
              {activeDelivery
                ? `No providers serve ${activeDelivery.label} yet`
                : 'No services listed yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {activeDelivery
                ? "Try a different location to see who's nearby."
                : 'Check back soon — providers are joining every day.'}
            </Text>
            {activeDelivery && (
              <TouchableRipple
                onPress={() => setPickerVisible(true)}
                style={styles.emptyAction}
                borderless
              >
                <Text style={styles.emptyActionText}>Change location</Text>
              </TouchableRipple>
            )}
          </View>
        ) : (
          results.slice(0, 8).map((result) => (
            <ServiceDiscoveryCard
              key={result.id}
              result={result}
              onPress={() => navigation.navigate('ServiceDetail', { serviceId: result.id })}
              onBook={() => handleBookPress(result)}
            />
          ))
        )}
      </ScrollView>

      <BookingSheet
        visible={!!bookingService}
        onClose={() => setBookingService(null)}
        serviceId={bookingService?.id ?? ''}
        serviceTitle={bookingService?.title ?? ''}
        basePrice={bookingService?.base_price ?? 0}
        onBooked={handleBooked}
      />

      <LocationPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={setActiveDelivery}
        title="Show providers near"
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: palette.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },

  // ── Top bar ───────────────────────────────────────────────────
  topBar: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   spacing.md,
  },
  brand: {
    fontFamily:    fontFamily.extraBold,
    fontSize:      15,
    color:         palette.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing.xs,
  },
  iconBtn: {
    width:           40,
    height:          40,
    borderRadius:    r.full,
    backgroundColor: palette.surface,
    borderWidth:     1,
    borderColor:     palette.border,
    alignItems:      'center',
    justifyContent:  'center',
  },

  // ── Greeting ──────────────────────────────────────────────────
  greeting: {
    fontFamily:   fontFamily.regular,
    fontSize:     13,
    color:        palette.textSecondary,
    marginBottom: 2,
  },
  headline: {
    fontFamily:   fontFamily.medium,
    fontSize:     22,
    lineHeight:   28,
    color:        palette.textPrimary,
    marginBottom: spacing.md,
  },

  // ── Carousel ──────────────────────────────────────────────────
  // Negative margins cancel the parent ScrollView's paddingHorizontal (spacing.lg)
  // so carousel slides render edge-to-edge.
  carouselWrap: {
    marginHorizontal: -spacing.lg,
    marginBottom:     spacing.md,
    overflow:         'hidden',
  },

  // ── Section headers ───────────────────────────────────────────
  sectionHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   spacing.sm,
    marginTop:      spacing.md,
  },
  sectionTitle: {
    fontFamily: fontFamily.medium,
    fontSize:   16,
    color:      palette.textPrimary,
  },
  sectionTitleBtn:  { borderRadius: r.sm, flexShrink: 1 },
  sectionTitleInner: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
    flexShrink:    1,
  },
  seeAllBtn: {
    borderRadius:      r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical:   spacing.xs,
  },
  seeAll: {
    fontFamily: fontFamily.medium,
    fontSize:   13,
    color:      palette.primary,
  },

  // ── Category grid (2-column wrap) ────────────────────────────
  categoryGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           spacing.sm,
    marginBottom:  spacing.xs,
  },
  catSkeletonGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           spacing.sm,
    marginBottom:  spacing.xs,
  },
  catSkeleton: {
    height:          52,
    borderRadius:    r.md,
    backgroundColor: palette.skeleton,
  },
  categoryTile: {
    backgroundColor: palette.surface,
    borderRadius:    r.md,
    borderWidth:     1,
    borderColor:     palette.border,
    overflow:        'hidden',
  },
  categoryTileInner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical:   spacing.sm + 2,
    minHeight:         52,
  },
  catIconCircle: {
    width:          32,
    height:         32,
    borderRadius:   r.full,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  catName: {
    fontFamily: fontFamily.regular,
    fontSize:   12,
    color:      palette.textPrimary,
    flex:       1,
  },

  // ── Your providers shelf ──────────────────────────────────────
  providerShelf: {
    gap:            spacing.md,
    paddingBottom:  spacing.xs,
  },
  providerChip: {
    alignItems:  'center',
    gap:         spacing.xs,
    width:       60,
  },
  providerChipAvatar: {
    width:           48,
    height:          48,
    borderRadius:    r.full,
    backgroundColor: palette.primaryLight,
    borderWidth:     1,
    borderColor:     palette.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  providerChipInitial: {
    fontFamily: fontFamily.medium,
    fontSize:   18,
    color:      palette.primary,
  },
  providerChipName: {
    fontFamily: fontFamily.regular,
    fontSize:   10,
    color:      palette.textSecondary,
    textAlign:  'center',
  },

  // ── Location nudge banner ────────────────────────────────────
  locationNudge: {
    borderRadius:    r.lg,
    backgroundColor: palette.primaryLight,
    borderWidth:     1,
    borderColor:     palette.border,
    marginBottom:    spacing.sm,
    overflow:        'hidden',
  },
  locationNudgeInner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm + 2,
  },
  locationNudgeText: {
    fontFamily: fontFamily.regular,
    fontSize:   13,
    color:      palette.primary,
    flex:       1,
  },

  // ── Empty state ───────────────────────────────────────────────
  cardSkeleton: { height: 112, borderRadius: r.lg, marginBottom: spacing.sm },
  emptyState: {
    alignItems:        'center',
    paddingVertical:   spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    fontFamily:   fontFamily.medium,
    fontSize:     15,
    color:        palette.textPrimary,
    textAlign:    'center',
    marginTop:    spacing.sm,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    fontFamily: fontFamily.regular,
    fontSize:   13,
    color:      palette.textSecondary,
    textAlign:  'center',
  },
  emptyAction: {
    marginTop:         spacing.md,
    backgroundColor:   palette.primaryLight,
    borderRadius:      r.full,
    paddingHorizontal: spacing.lg,
    paddingVertical:   spacing.sm,
  },
  emptyActionText: {
    fontFamily: fontFamily.medium,
    fontSize:   13,
    color:      palette.primary,
  },
});
