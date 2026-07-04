import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { Text, TouchableRipple } from "react-native-paper";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { CardSkeleton } from "../../components/ui/SkeletonBlock";
import { NotificationBell } from "../../components/ui/NotificationBell";
import { BookingSheet } from "../../components/booking/BookingSheet";
import { LocationPickerSheet } from "../../components/location/LocationPickerSheet";
import { HomeBannerCarousel } from "../../components/discovery/HomeBannerCarousel";
import { ServiceDiscoveryCard } from "../../components/discovery/ServiceDiscoveryCard";
import { ApiError } from "../../api/errors";
import { BookAgainCard, bookingsApi, MyProvider } from "../../api/bookings";
import { searchApi, SearchResult } from "../../api/search";
import { Service, servicesApi } from "../../api/services";
import { useSnackbar } from "../../providers/SnackbarProvider";
import { useAuthStore } from "../../store/authStore";
import { useCategoryStore } from "../../store/categoryStore";
import { useLocationStore } from "../../store/locationStore";
import { palette, radius as r, spacing } from "../../theme";
import { fontFamily } from "../../theme/typography";

// ── Constants ────────────────────────────────────────────────────────────────

const SCREEN_W = Dimensions.get("window").width;
// Tile width for the 2-column category grid
const TILE_W = Math.floor((SCREEN_W - 2 * spacing.lg - spacing.sm) / 2);

// Deterministic palette — rotates by category.id so new categories always get a colour
const CAT_PALETTE = [
  "#0891B2",
  "#2563EB",
  "#7C3AED",
  "#D97706",
  "#DB2777",
  "#16A34A",
  "#4B5563",
  "#0369A1",
  "#15803D",
  "#B45309",
  "#1D4ED8",
  "#1E40AF",
  "#92400E",
  "#9D174D",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function toBookableService(r: SearchResult): Service {
  return {
    id: r.id,
    provider_id: r.provider_id,
    category_id: r.category.id,
    category: { ...r.category, icon_url: null },
    title: r.title,
    description: r.description,
    pricing_model: r.pricing_model,
    base_price: r.base_price,
    // Search results don't carry the per-model pricing details; the booking
    // sheet fetches the full service before charging anything.
    hourly_rate: null,
    minimum_hours: null,
    cap_hours: null,
    cap_amount: null,
    deposit_percent: null,
    scope_prompts: [],
    needs_pricing_review: false,
    payment_mode: r.payment_mode,
    duration_estimate_mins: null,
    status: "ACTIVE",
    is_pinned: false,
    latitude: r.latitude,
    longitude: r.longitude,
    distance_km: r.distance_km,
    // Slim search-result provider → full ServiceProvider shape; display-only
    // fields the search payload doesn't carry default to empty.
    provider: {
      ...r.provider,
      bio: null,
      avatar_url: null,
      cover_image_url: null,
      kyc_status: null,
      year_started: null,
      languages: [],
      certifications: [],
      base_location_label: null,
      availability_matrix: null,
      repeat_client_rate: null,
      portfolio_images: [],
      badges: [],
    },
    inclusions: [],
    addons: [],
    photos: [],
    reviews: [],
    review_count: r.provider.v_reviews,
    star_distribution: [],
    created_at: "",
  };
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation }: any) {
  const { categories, fetchCategories, loading: cLoading } = useCategoryStore();
  const { primaryLocation, setPrimary } = useLocationStore();
  const { showError, showSnackbar } = useSnackbar();
  const user = useAuthStore((s) => s.user);
  const activeRole = useAuthStore((s) => s.activeRole);
  const insets = useSafeAreaInsets();

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [myProviders, setMyProviders] = useState<MyProvider[]>([]);
  const [bookAgain, setBookAgain] = useState<BookAgainCard | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [bookingService, setBookingService] = useState<Service | null>(null);

  useEffect(() => {
    fetchCategories();
  }, []);

  // Fetch "Your providers" + "Book again" from completed history — silent fail
  useEffect(() => {
    if (!user || activeRole !== "CUSTOMER") return;
    bookingsApi
      .myProviders()
      .then(setMyProviders)
      .catch(() => {});
    bookingsApi
      .bookAgain()
      .then(setBookAgain)
      .catch(() => {});
  }, [user?.id, activeRole]);

  const runDiscovery = useCallback(async () => {
    setLoading(true);
    try {
      const res = await searchApi.search({
        ...(primaryLocation
          ? { lat: primaryLocation.lat, lng: primaryLocation.lng }
          : {}),
        // Region enables promoted-slot matching (v3.2 §1.5 — category × region)
        ...(primaryLocation?.region ? { region: primaryLocation.region } : {}),
        page: 1,
      });
      setResults(res.data);
      setIsFallback(res.fallback ?? false);
    } catch (e) {
      showError(e instanceof ApiError ? e.message : "Could not load services.");
    } finally {
      setLoading(false);
    }
  }, [primaryLocation]);

  useEffect(() => {
    runDiscovery();
  }, [primaryLocation]);

  const handleCategoryPress = (categoryId: number) => {
    navigation.navigate("BrowseMain", { categoryId });
  };

  const handleBookPress = useCallback(
    async (result: SearchResult) => {
      // Quote-first models go through the same sheet — it collects the brief
      // instead of taking payment, so no special-casing needed here.
      try {
        const full = await servicesApi.show(result.id);
        setBookingService(full);
      } catch {
        setBookingService(toBookableService(result));
      }
    },
    []
  );

  const handleBooked = useCallback(
    (bookingId: string) => {
      setBookingService(null);
      navigation.navigate("Bookings", {
        screen: "BookingDetail",
        params: { bookingId },
      });
    },
    [navigation]
  );

  const handleBannerAction = useCallback(
    (action: string) => {
      // Simple router: "Search?q=cleaning" → navigate to Search with query
      if (action.startsWith("Search")) {
        navigation.navigate("Search");
      }
    },
    [navigation]
  );

  const handlePrimarySelect = useCallback(
    async (loc: {
      lat: number;
      lng: number;
      label: string;
      region: string | null;
      source: "DEVICE" | "SEARCH" | "SAVED";
    }) => {
      const ok = await setPrimary(loc);
      if (!ok) showError("Could not update your location.");
    },
    [setPrimary, showError]
  );

  const sectionLabel =
    primaryLocation && !isFallback
      ? `Top rated near - ${primaryLocation.label}`
      : primaryLocation && isFallback
      ? "Top rated providers"
      : "Explore services";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 112 },
        ]}
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
              accessibilityLabel={
                primaryLocation
                  ? `Location: ${primaryLocation.label}`
                  : "Set location"
              }
              accessibilityRole="button"
            >
              <Ionicons
                name={primaryLocation ? "location" : "location-outline"}
                size={20}
                color={primaryLocation ? palette.primary : palette.textPrimary}
              />
            </TouchableOpacity>
            <NotificationBell />
          </View>
        </View>

        {/* ── Greeting + headline ────────────────────────────────────── */}
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.headline}>Find trusted help{"\n"}near you</Text>
        <View style={styles.horizontalDivider} />
        {/* ── Promo carousel (data-driven, collapses when empty) ─────── */}
        {/* Negative margins cancel the parent's paddingHorizontal so slides
            run edge-to-edge; content inside each slide is re-padded. */}
        <View style={styles.carouselWrap}>
          <HomeBannerCarousel onAction={handleBannerAction} />
        </View>
        <View style={styles.horizontalDivider} />
        {/* ── Categories ─────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Categories</Text>
          <TouchableRipple
            onPress={() => navigation.navigate("Search")}
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
                    <View
                      style={[
                        styles.catIconCircle,
                        { backgroundColor: `${iconColor}18` },
                      ]}
                    >
                      <Ionicons
                        name={
                          (cat.icon ?? "grid-outline") as React.ComponentProps<
                            typeof Ionicons
                          >["name"]
                        }
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

        <View style={styles.horizontalDivider} />

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
                  onPress={() =>
                    navigation.navigate("ProviderProfile", { providerId: p.id })
                  }
                  activeOpacity={0.75}
                >
                  <View style={styles.providerChipAvatar}>
                    <Text style={styles.providerChipInitial}>
                      {(p.display_name || "?")[0].toUpperCase()}
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

        {/* ── Book again (v3.2 §2.3 — highest-conversion surface) ─────── */}
        {bookAgain && (
          <>
            <View style={styles.horizontalDivider} />
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Book again</Text>
            </View>
            <TouchableRipple
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                navigation.navigate("ServiceDetail", {
                  serviceId: bookAgain.service.id,
                });
              }}
              borderless
              style={styles.bookAgainCard}
              accessibilityRole="button"
              accessibilityLabel={`Book ${bookAgain.service.title} again with ${
                bookAgain.provider.display_name ?? "your provider"
              }`}
            >
              <View style={styles.bookAgainInner}>
                <View style={styles.bookAgainAvatar}>
                  <Text style={styles.bookAgainInitial}>
                    {(bookAgain.provider.display_name || "?")[0].toUpperCase()}
                  </Text>
                </View>
                <View style={styles.bookAgainBody}>
                  <Text style={styles.bookAgainTitle} numberOfLines={1}>
                    {bookAgain.service.title}
                  </Text>
                  <Text style={styles.bookAgainSub} numberOfLines={1}>
                    {bookAgain.provider.display_name}
                    {bookAgain.delivery.label
                      ? ` · ${bookAgain.delivery.label}`
                      : ""}
                  </Text>
                </View>
                <View style={styles.bookAgainCta}>
                  <Ionicons name="repeat" size={14} color="#FFFFFF" />
                  <Text style={styles.bookAgainCtaText}>Rebook</Text>
                </View>
              </View>
            </TouchableRipple>
          </>
        )}

        {/* ── Post a request (v3.2 §6 — urgency / thin-category entry) ── */}
        <TouchableRipple
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            navigation.navigate("PostRequest");
          }}
          borderless
          style={styles.postRequestCard}
          accessibilityRole="button"
          accessibilityLabel="Post a request — describe the job and nearby providers reply with prices"
        >
          <View style={styles.postRequestInner}>
            <View style={styles.postRequestIcon}>
              <Ionicons
                name="megaphone-outline"
                size={18}
                color={palette.primary}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.postRequestTitle}>Need someone now?</Text>
              <Text style={styles.postRequestSub} numberOfLines={1}>
                Post a request — nearby providers reply with prices
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={palette.textDisabled}
            />
          </View>
        </TouchableRipple>
        <View style={styles.horizontalDivider} />
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
              <Ionicons
                name="chevron-down"
                size={15}
                color={palette.textSecondary}
              />
            </View>
          </TouchableRipple>
          <TouchableRipple
            onPress={() => navigation.navigate("Search")}
            borderless
            style={styles.seeAllBtn}
          >
            <Text style={styles.seeAll}>See all</Text>
          </TouchableRipple>
        </View>

        {/* Soft location nudge — informational, never blocks the feed */}
        {!primaryLocation && (
          <TouchableRipple
            onPress={() => setPickerVisible(true)}
            style={styles.locationNudge}
            rippleColor="rgba(123,26,58,0.06)"
          >
            <View style={styles.locationNudgeInner}>
              <Ionicons
                name="location-outline"
                size={14}
                color={palette.primary}
              />
              <Text style={styles.locationNudgeText}>
                Set your location to see providers near you
              </Text>
              <Ionicons
                name="chevron-forward"
                size={14}
                color={palette.primary}
              />
            </View>
          </TouchableRipple>
        )}

        {/* Fallback notice — shown when location is set but no providers cover it */}
        {isFallback && primaryLocation && results.length > 0 && (
          <TouchableRipple
            onPress={() => setPickerVisible(true)}
            style={styles.fallbackNotice}
            rippleColor="rgba(123,26,58,0.06)"
          >
            <View style={styles.fallbackNoticeInner}>
              <Ionicons
                name="information-circle-outline"
                size={14}
                color={palette.textSecondary}
              />
              <Text style={styles.fallbackNoticeText}>
                No providers in {primaryLocation.label} yet — showing top rated
                providers
              </Text>
              <Ionicons
                name="chevron-forward"
                size={14}
                color={palette.textSecondary}
              />
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
            <Ionicons
              name="search-outline"
              size={40}
              color={palette.textDisabled}
            />
            <Text style={styles.emptyTitle}>
              {primaryLocation
                ? `No providers serve ${primaryLocation.label} yet`
                : "No services listed yet"}
            </Text>
            <Text style={styles.emptyBody}>
              {primaryLocation
                ? "Try a different location to see who's nearby."
                : "Check back soon — providers are joining every day."}
            </Text>
            {primaryLocation && (
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
          results
            .slice(0, 8)
            .map((result, i) => (
              <React.Fragment key={result.id}>
                {i > 0 && <View style={styles.cardDivider} />}
                <ServiceDiscoveryCard
                  result={result}
                  onPress={() =>
                    navigation.navigate("ServiceDetail", { serviceId: result.id })
                  }
                  onBook={() => handleBookPress(result)}
                />
              </React.Fragment>
            ))
        )}
      </ScrollView>

      <BookingSheet
        visible={!!bookingService}
        onClose={() => setBookingService(null)}
        serviceId={bookingService?.id ?? ""}
        serviceTitle={bookingService?.title ?? ""}
        basePrice={bookingService?.base_price ?? 0}
        pricingModel={bookingService?.pricing_model}
        paymentMode={bookingService?.payment_mode}
        availabilityMatrix={bookingService?.provider?.availability_matrix}
        categoryId={bookingService?.category?.id}
        providerName={bookingService?.provider?.display_name}
        durationMins={bookingService?.duration_estimate_mins}
        thumbUri={bookingService?.photos?.[0]?.path ?? null}
        addons={bookingService?.addons}
        onBooked={handleBooked}
      />

      <LocationPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handlePrimarySelect}
        title="Show providers near"
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },

  // ── Top bar ───────────────────────────────────────────────────
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  brand: {
    fontFamily: fontFamily.extraBold,
    fontSize: 15,
    color: palette.primary,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  topBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: r.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Greeting ──────────────────────────────────────────────────
  greeting: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: palette.textSecondary,
    marginBottom: 2,
  },
  headline: {
    fontFamily: fontFamily.medium,
    fontSize: 22,
    lineHeight: 28,
    color: palette.textPrimary,
    marginBottom: spacing.md,
  },

  // ── Carousel ──────────────────────────────────────────────────
  // Negative margins cancel the parent ScrollView's paddingHorizontal (spacing.lg)
  // so carousel slides render edge-to-edge.
  carouselWrap: {
    marginHorizontal: -spacing.lg,
    marginBottom: spacing.md,
    overflow: "hidden",
  },

  // ── Section headers ───────────────────────────────────────────
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    color: palette.textPrimary,
  },
  sectionTitleBtn: { borderRadius: r.sm, flexShrink: 1 },
  sectionTitleInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
  },
  seeAllBtn: {
    borderRadius: r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  seeAll: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: palette.primary,
  },

  // ── Category grid (2-column wrap) ────────────────────────────
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  catSkeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  catSkeleton: {
    height: 52,
    borderRadius: r.sm,
    backgroundColor: palette.skeleton,
  },
  categoryTile: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden",
  },
  categoryTileInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm + 2,
    minHeight: 52,
  },
  catIconCircle: {
    width: 32,
    height: 32,
    borderRadius: r.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  catName: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: palette.textPrimary,
    flex: 1,
  },

  // ── Your providers shelf ──────────────────────────────────────
  providerShelf: {
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  providerChip: {
    alignItems: "center",
    gap: spacing.xs,
    width: 60,
  },
  providerChipAvatar: {
    width: 48,
    height: 48,
    borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
  },
  providerChipInitial: {
    fontFamily: fontFamily.medium,
    fontSize: 18,
    color: palette.primary,
  },
  providerChipName: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: palette.textSecondary,
    textAlign: "center",
  },

  horizontalDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    marginVertical: 15,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    marginVertical: spacing.md,
  },
  // ── Book again card (v3.2 §2.3) ──────────────────────────────
  bookAgainCard: {
    borderRadius: r.sm,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  bookAgainInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  bookAgainAvatar: {
    width: 44,
    height: 44,
    borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  bookAgainInitial: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    color: palette.primary,
  },
  bookAgainBody: { flex: 1, minWidth: 0 },
  bookAgainTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    color: palette.textPrimary,
  },
  bookAgainSub: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: palette.textSecondary,
    marginTop: 2,
  },
  bookAgainCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: palette.primary,
    borderRadius: r.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  bookAgainCtaText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 12,
    color: "#FFFFFF",
  },

  // ── Post a request entry (v3.2 §6) ───────────────────────────
  postRequestCard: {
    borderRadius: r.sm,
    backgroundColor: palette.primaryLight,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
    overflow: "hidden",
  },
  postRequestInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  postRequestIcon: {
    width: 38,
    height: 38,
    borderRadius: r.full,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  postRequestTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    color: palette.textPrimary,
  },
  postRequestSub: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: palette.textSecondary,
    marginTop: 2,
  },

  // ── Location nudge banner ────────────────────────────────────
  locationNudge: {
    borderRadius: r.sm,
    backgroundColor: palette.primaryLight,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  locationNudgeInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  locationNudgeText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: palette.primary,
    flex: 1,
  },

  // ── Fallback notice (no local providers) ─────────────────────
  fallbackNotice: {
    borderRadius: r.sm,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  fallbackNoticeInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  fallbackNoticeText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: palette.textSecondary,
    flex: 1,
  },

  // ── Empty state ───────────────────────────────────────────────
  cardSkeleton: { height: 112, borderRadius: r.sm, marginBottom: spacing.sm },
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    color: palette.textPrimary,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: palette.textSecondary,
    textAlign: "center",
  },
  emptyAction: {
    marginTop: spacing.md,
    backgroundColor: palette.primaryLight,
    borderRadius: r.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  emptyActionText: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: palette.primary,
  },
});
