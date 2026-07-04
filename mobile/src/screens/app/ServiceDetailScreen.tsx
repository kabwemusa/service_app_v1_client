import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { Text, TouchableRipple } from "react-native-paper";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { ApiError } from "../../api/errors";
import { Service, servicesApi } from "../../api/services";
import { storageUrl } from "../../api/client";
import { BookingSheet } from "../../components/booking/BookingSheet";
import { MarkdownView } from "../../components/ui/MarkdownView";
import { SkeletonBlock } from "../../components/ui/SkeletonBlock";
import { VettingBadge } from "../../components/discovery/VettingBadge";
import { useSnackbar } from "../../providers/SnackbarProvider";
import { useLocationStore } from "../../store/locationStore";
import { palette, radius as r, spacing, typography } from "../../theme";
import { fontFamily } from "../../theme/typography";

const SCREEN_W = Dimensions.get("window").width;
const HERO_H = 320;

type IconName = React.ComponentProps<typeof Ionicons>["name"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function responseLabel(p50: number): string {
  if (p50 < 10) return "< 10 min";
  if (p50 < 30) return "< 30 min";
  if (p50 < 60) return "< 1 hr";
  if (p50 < 120) return "< 2 hrs";
  return "same day";
}

// Quote-first models: price only exists after the provider's scoped quote.
function isQuoteFirst(s: Service): boolean {
  return s.pricing_model === "PROVIDER_SCOPE" || s.pricing_model === "QUOTE_DEPOSIT";
}

function capTotal(s: Service): number | null {
  return s.cap_amount ?? (s.hourly_rate != null && s.cap_hours != null ? s.hourly_rate * s.cap_hours : null);
}

function priceLabel(s: Service): string {
  if (isQuoteFirst(s)) return "Quoted after brief";
  if (s.pricing_model === "HOURLY_CAPPED" && s.hourly_rate != null) {
    const cap = capTotal(s);
    return `ZMW ${s.hourly_rate.toFixed(0)}/hr · ${s.minimum_hours ?? 1}-hr min${cap != null ? ` · max ZMW ${cap.toFixed(0)}` : ""}`;
  }
  return s.base_price != null ? `ZMW ${s.base_price.toFixed(0)}` : "—";
}

function ctaText(s: Service): string {
  if (isQuoteFirst(s)) return "Get a quote";
  // DIRECT: provider confirms the request, customer pays them directly afterwards.
  if (s.payment_mode === "DIRECT") return "Request booking";
  if (s.pricing_model === "HOURLY_CAPPED") {
    const cap = capTotal(s);
    return cap != null ? `Book · hold ZMW ${cap.toFixed(0)}` : "Book";
  }
  // ESCROW: customer funds into escrow up front — surface the price on the CTA.
  return s.base_price != null ? `Book · ZMW ${s.base_price.toFixed(0)}` : "Book";
}

function initials(name?: string | null): string {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ uri, name, size }: { uri: string | null; name: string | null; size: number }) {
  const [err, setErr] = useState(false);
  if (uri && !err) {
    return (
      <Image
        source={{ uri: storageUrl(uri) }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.border }}
        contentFit="cover"
        cachePolicy="memory-disk"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.primaryLight, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: fontFamily.semiBold, fontSize: size * 0.36, color: palette.primary }}>{initials(name)}</Text>
    </View>
  );
}

function Pill({ icon, label, color }: { icon: IconName; label: string; color?: string }) {
  return (
    <View style={st.pill}>
      <Ionicons name={icon} size={13} color={color ?? palette.textSecondary} />
      <Text style={st.pillText}>{label}</Text>
    </View>
  );
}

function ReviewRow({ review }: { review: { id: string; rating: number; comment: string | null; created_at: string; reviewer: { name: string } } }) {
  const stars = Math.round(review.rating);
  const date = new Date(review.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <View style={st.reviewItem}>
      <View style={st.reviewTop}>
        <View style={st.reviewerChip}>
          <View style={st.reviewerDot}><Ionicons name="person" size={10} color={palette.primary} /></View>
          <Text style={st.reviewerName}>{review.reviewer.name}</Text>
        </View>
        <Text style={st.reviewDate}>{date}</Text>
      </View>
      <View style={st.starsRow} accessibilityLabel={`${stars} out of 5 stars`}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Ionicons key={i} name={i < stars ? "star" : "star-outline"} size={12} color={i < stars ? palette.warning : palette.textDisabled} />
        ))}
      </View>
      {review.comment ? <Text style={st.reviewComment} numberOfLines={4}>{review.comment}</Text> : null}
    </View>
  );
}

function DetailSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <SkeletonBlock width="100%" height={HERO_H} radius={0} />
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <SkeletonBlock width="30%" height={12} />
        <SkeletonBlock width="80%" height={24} />
        <SkeletonBlock width="100%" height={60} radius={r.sm} />
        <SkeletonBlock width="100%" height={180} radius={r.sm} />
        <SkeletonBlock width="100%" height={100} radius={r.sm} />
      </View>
    </View>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ServiceDetailScreen({ navigation, route }: any) {
  const serviceId: string = route.params?.serviceId;
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const { showError } = useSnackbar();
  const { primaryLocation } = useLocationStore();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => { scrollY.value = e.contentOffset.y; },
  });

  useEffect(() => {
    (async () => {
      try {
        setService(await servicesApi.show(serviceId));
      } catch (e) {
        showError(e instanceof ApiError ? e.message : "Failed to load service.");
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [serviceId]);

  const provider = service?.provider ?? null;
  const reviews = service?.reviews ?? [];
  const reviewCount = service?.review_count ?? 0;
  const activeDays = provider?.availability_matrix
    ? Object.values(provider.availability_matrix).filter((s) => s.length > 0).length : null;

  // ── Animated header opacity on scroll ─────────────────────────────────────
  const headerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, HERO_H - 100], [0, 1], "clamp"),
    backgroundColor: palette.surface,
  }));

  if (loading || !service) {
    return <SafeAreaView style={st.safe}><DetailSkeleton /></SafeAreaView>;
  }

  const hasPhotos = (service.photos ?? []).length > 0;

  return (
    <View style={st.safe}>
      {/* ── Compact sticky header (fades in on scroll) ──────────────────── */}
      <Animated.View style={[st.stickyHeader, headerStyle, { paddingTop: insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={st.headerBtn}>
          <Ionicons name="arrow-back" size={20} color={palette.textPrimary} />
        </Pressable>
        <Text style={st.headerTitle} numberOfLines={1}>{service.title}</Text>
        <View style={{ width: 40 }} />
      </Animated.View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* ── 1. Hero gallery ─────────────────────────────────────────── */}
        <View style={st.heroWrap}>
          {hasPhotos ? (
            <FlatList
              data={service.photos}
              keyExtractor={(p) => String(p.id)}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                setPhotoIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
              }}
              scrollEventThrottle={16}
              renderItem={({ item }) => (
                <Image source={{ uri: storageUrl(item.path) }} style={st.heroImg} contentFit="cover" cachePolicy="memory-disk" transition={200} />
              )}
            />
          ) : (
            <View style={st.heroFallback}>
              <Ionicons name="images-outline" size={48} color={palette.primary} />
            </View>
          )}

          {/* Gradient scrim at bottom for readability */}
          <View style={st.heroScrim} />

          {/* Overlay controls */}
          <View style={[st.heroOverlay, { paddingTop: insets.top + spacing.xs }]}>
            <Pressable onPress={() => navigation.goBack()} style={st.heroBtn} hitSlop={8} accessibilityLabel="Go back">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <View style={st.heroRight}>
              <Pressable onPress={() => Share.share({ message: `Check out "${service.title}" on Sebenza.` })} style={st.heroBtn} hitSlop={8} accessibilityLabel="Share">
                <Ionicons name="share-outline" size={20} color="#fff" />
              </Pressable>
              <Pressable onPress={() => setSaved((s) => !s)} style={st.heroBtn} hitSlop={8} accessibilityLabel={saved ? "Unsave" : "Save"}>
                <Ionicons name={saved ? "heart" : "heart-outline"} size={20} color={saved ? "#F87171" : "#fff"} />
              </Pressable>
            </View>
          </View>

          {/* Page indicator */}
          {hasPhotos && service.photos.length > 1 && (
            <View style={st.heroDots}>
              {service.photos.map((_, i) => (
                <View key={i} style={[st.dot, i === photoIdx && st.dotActive]} />
              ))}
            </View>
          )}
        </View>

        {/* ── 2. Title band (overlaps hero slightly) ───────────────────── */}
        <View style={st.titleBand}>
          <View style={st.catPill}>
            <Text style={st.catPillText}>{service.category?.name ?? "Service"}</Text>
          </View>
          <Text style={st.title}>{service.title}</Text>

          {/* Horizontal trust pills — the modern "at a glance" row */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.pillRow}>
            <Pill icon="cash-outline" label={priceLabel(service)} color={palette.primary} />
            {service.duration_estimate_mins ? (
              <Pill icon="time-outline" label={fmt(service.duration_estimate_mins)} />
            ) : null}
            {provider?.r_raw != null && provider.v_reviews > 0 && (
              <Pill icon="star" label={`${provider.r_raw.toFixed(1)} (${provider.v_reviews})`} color={palette.warning} />
            )}
            {provider?.response_time_p50_mins != null && (
              <Pill icon="flash-outline" label={`Responds ${responseLabel(provider.response_time_p50_mins)}`} color={palette.warning} />
            )}
            {primaryLocation && <Pill icon="location" label={primaryLocation.label} color={palette.success} />}
          </ScrollView>
        </View>

        <View style={st.body}>
          {/* ── Provider ─────────────────────────────────────────────────── */}
          {provider && (
            <TouchableRipple
              borderless
              style={st.providerCard}
              onPress={() => navigation.navigate("ProviderProfile", { providerId: provider.id })}
              accessibilityRole="button"
              accessibilityLabel={`View ${provider.display_name}'s profile`}
            >
              <View style={st.providerInner}>
                <Avatar uri={provider.avatar_url} name={provider.display_name} size={48} />
                <View style={st.providerMeta}>
                  <View style={st.providerNameRow}>
                    <Text style={st.providerName} numberOfLines={1}>{provider.display_name ?? "Provider"}</Text>
                    {provider.kyc_status === "VERIFIED" && (
                      <Ionicons name="checkmark-circle" size={14} color={palette.success} />
                    )}
                  </View>
                  <View style={st.providerTags}>
                    <VettingBadge trustTier={provider.trust_tier} size="sm" />
                    {provider.base_location_label ? (
                      <View style={st.locTag}>
                        <Ionicons name="location-outline" size={10} color={palette.textSecondary} />
                        <Text style={st.locTagText} numberOfLines={1}>{provider.base_location_label}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
              </View>
            </TouchableRipple>
          )}

          {/* ── About this service ───────────────────────────────────────── */}
          {service.description ? (
            <View style={st.section}>
              <Text style={st.sectionTitle}>About this service</Text>
              <View style={st.sectionDivider} />
              <View style={st.sectionContent}>
                <MarkdownView>{service.description}</MarkdownView>
              </View>
            </View>
          ) : null}

          {/* ── What's included ───────────────────────────────────────────── */}
          {(service.inclusions ?? []).length > 0 && (
            <View style={st.section}>
              <Text style={st.sectionTitle}>What's included</Text>
              <View style={st.sectionDivider} />
              <View style={st.sectionContent}>
                {service.inclusions.map((item, i) => (
                  <View key={i} style={st.inclusionRow}>
                    <View style={st.checkCircle}>
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    </View>
                    <Text style={st.inclusionText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Available extras ──────────────────────────────────────────── */}
          {(service.addons ?? []).length > 0 && (
            <View style={st.section}>
              <View style={st.sectionHead}>
                <Text style={st.sectionTitle}>Available extras</Text>
                <Text style={st.sectionMeta}>Add when booking</Text>
              </View>
              <View style={st.sectionDivider} />
              <View style={st.sectionContent}>
                {service.addons.map((addon, i) => (
                  <View key={addon.id} style={[st.addonRow, i > 0 && st.addonBorder]}>
                    <View style={st.addonIconWrap}>
                      <Ionicons name="add-circle-outline" size={16} color={palette.primary} />
                    </View>
                    <Text style={st.addonName} numberOfLines={1}>{addon.name}</Text>
                    <Text style={st.addonPrice}>+ ZMW {addon.price.toFixed(0)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Good to know ─────────────────────────────────────────────── */}
          <View style={st.section}>
            <Text style={st.sectionTitle}>Good to know</Text>
            <View style={st.sectionDivider} />
            <View style={st.sectionContent}>
              {activeDays != null && (
                <View style={st.infoRow}>
                  <View style={st.infoIcon}><Ionicons name="calendar-outline" size={14} color={palette.primary} /></View>
                  <Text style={st.infoText}>Available {activeDays} day{activeDays === 1 ? "" : "s"} a week</Text>
                </View>
              )}
              <View style={st.infoRow}>
                <View style={st.infoIcon}><Ionicons name="shield-checkmark-outline" size={14} color={palette.success} /></View>
                <Text style={st.infoText}>
                  {service.payment_mode === "DIRECT"
                    ? "Free cancellation before the provider starts. You pay them directly."
                    : "Full refund if you cancel before the provider is en route."}
                </Text>
              </View>
              {service.payment_mode === "DIRECT" && (
                <View style={st.infoRow}>
                  <View style={st.infoIcon}><Ionicons name="cash-outline" size={14} color={palette.primary} /></View>
                  <Text style={st.infoText}>Pay the provider directly after the job — no payment held by the platform.</Text>
                </View>
              )}
            </View>
          </View>

          {/* ── Reviews ──────────────────────────────────────────────────── */}
          <View style={st.section}>
            <View style={st.sectionHead}>
              <Text style={st.sectionTitle}>Reviews</Text>
              {provider?.r_raw != null && (
                <View style={st.ratingBadge}>
                  <Ionicons name="star" size={13} color={palette.warning} />
                  <Text style={st.ratingBadgeText}>{provider.r_raw.toFixed(1)}</Text>
                  <Text style={st.ratingBadgeCount}>({reviewCount})</Text>
                </View>
              )}
            </View>
            <View style={st.sectionDivider} />

            {reviewCount === 0 ? (
              <View style={st.emptyReviews}>
                <Ionicons name="chatbubble-outline" size={28} color={palette.textDisabled} />
                <Text style={st.emptyReviewsText}>No reviews yet</Text>
              </View>
            ) : (
              <View style={st.sectionContent}>
                {reviews.slice(0, 2).map((rev, i) => (
                  <React.Fragment key={rev.id}>
                    {i > 0 && <View style={st.divider} />}
                    <ReviewRow review={rev} />
                  </React.Fragment>
                ))}
                {reviewCount > 2 && (
                  <>
                    <View style={st.divider} />
                    <TouchableRipple
                      onPress={() => navigation.navigate("AllReviews", { providerId: service.provider_id })}
                      style={st.seeAllRow}
                      accessibilityRole="button"
                      accessibilityLabel={`See all ${reviewCount} reviews`}
                    >
                      <View style={st.seeAllInner}>
                        <Text style={st.seeAllText}>See all {reviewCount} reviews</Text>
                        <Ionicons name="arrow-forward" size={13} color={palette.primary} />
                      </View>
                    </TouchableRipple>
                  </>
                )}
              </View>
            )}
          </View>
        </View>
      </Animated.ScrollView>

      {/* ── Bottom action bar ────────────────────────────────────────── */}
      <View style={[st.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) + spacing.xs }]}>
        <View style={st.bottomInner}>
          <View style={st.bottomLeft}>
            {isQuoteFirst(service) ? (
              <Text style={st.bottomQuote}>Quoted after brief</Text>
            ) : service.pricing_model === "HOURLY_CAPPED" && service.hourly_rate != null ? (
              <>
                <Text style={st.bottomPrice}>
                  ZMW {service.hourly_rate.toFixed(0)}
                  <Text style={st.bottomPriceUnit}>/hr</Text>
                </Text>
                {capTotal(service) != null && (
                  <Text style={st.bottomFrom}>max ZMW {capTotal(service)!.toFixed(0)}</Text>
                )}
              </>
            ) : service.base_price != null ? (
              <>
                <Text style={st.bottomFrom}>from</Text>
                <Text style={st.bottomPrice}>ZMW {service.base_price.toFixed(0)}</Text>
              </>
            ) : (
              <Text style={st.bottomQuote}>Quoted after brief</Text>
            )}
          </View>
          <Pressable
            onPress={() => setBookingOpen(true)}
            style={st.ctaBtn}
            accessibilityRole="button"
            accessibilityLabel={ctaText(service)}
          >
            <Ionicons name="calendar-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={st.ctaBtnText}>{ctaText(service)}</Text>
          </Pressable>
        </View>
      </View>

      <BookingSheet
        visible={bookingOpen}
        onClose={() => setBookingOpen(false)}
        serviceId={service.id}
        serviceTitle={service.title}
        basePrice={service.base_price ?? 0}
        pricingModel={service.pricing_model}
        hourlyRate={service.hourly_rate}
        minimumHours={service.minimum_hours}
        capHours={service.cap_hours}
        capAmount={service.cap_amount}
        depositPercent={service.deposit_percent}
        scopePrompts={service.scope_prompts}
        paymentMode={service.payment_mode}
        availabilityMatrix={service.provider?.availability_matrix}
        thumbUri={service.photos?.[0] ? storageUrl(service.photos[0].path) : undefined}
        categoryId={service.category?.id}
        providerName={service.provider?.display_name}
        durationMins={service.duration_estimate_mins}
        addons={service.addons}
        onBooked={(bookingId) => navigation.navigate("BookingDetail", { bookingId })}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const HAIRLINE = StyleSheet.hairlineWidth;

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  // Sticky header
  stickyHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: palette.border,
  },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.label, flex: 1, textAlign: "center", fontSize: 15, color: palette.textPrimary },

  // Hero
  heroWrap: { width: SCREEN_W, height: HERO_H, backgroundColor: palette.primaryLight },
  heroImg: { width: SCREEN_W, height: HERO_H },
  heroFallback: { width: SCREEN_W, height: HERO_H, alignItems: "center", justifyContent: "center", backgroundColor: palette.primaryLight },
  heroScrim: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: 80,
    // simple gradient via semi-transparent layers
    backgroundColor: "transparent",
  },
  heroOverlay: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: spacing.md,
  },
  heroBtn: {
    width: 40, height: 40, borderRadius: r.full,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  heroRight: { flexDirection: "row", gap: spacing.xs },
  heroDots: {
    position: "absolute", bottom: spacing.sm, left: 0, right: 0,
    flexDirection: "row", justifyContent: "center", gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.45)" },
  dotActive: { width: 20, backgroundColor: "#fff", borderRadius: 3 },

  // Title band
  titleBand: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: palette.background,
  },
  catPill: {
    alignSelf: "flex-start",
    backgroundColor: palette.primaryLight,
    borderRadius: r.full,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm + 2,
    marginBottom: spacing.xs,
  },
  catPillText: { fontFamily: fontFamily.medium, fontSize: 11, color: palette.primary, letterSpacing: 0.3 },
  title: { fontFamily: fontFamily.bold, fontSize: 22, lineHeight: 28, color: palette.textPrimary, marginBottom: spacing.sm },

  // Trust pills
  pillRow: { gap: spacing.xs, paddingBottom: spacing.xs },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: palette.surface,
    borderWidth: HAIRLINE, borderColor: palette.border,
    borderRadius: r.full,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 6,
  },
  pillText: { fontFamily: fontFamily.medium, fontSize: 12, color: palette.textSecondary },

  // Body
  body: { paddingHorizontal: spacing.lg, gap: spacing.lg, paddingTop: spacing.xs },

  // Section: heading outside, divider, content in a subtle surface card
  section: { gap: 0 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontFamily: fontFamily.semiBold, fontSize: 15, color: palette.textPrimary },
  sectionMeta: { fontFamily: fontFamily.regular, fontSize: 12, color: palette.textSecondary },
  sectionDivider: { height: HAIRLINE, backgroundColor: palette.border, marginTop: spacing.sm, marginBottom: spacing.sm },
  sectionContent: {
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderWidth: HAIRLINE,
    borderColor: palette.border,
    borderRadius: r.sm,
    padding: spacing.md,
  },

  // Provider card
  providerCard: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: HAIRLINE,
    borderColor: palette.border,
    padding: spacing.md,
    overflow: "hidden",
  },
  providerInner: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  providerMeta: { flex: 1 },
  providerNameRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  providerName: { fontFamily: fontFamily.semiBold, fontSize: 15, color: palette.textPrimary, flex: 1 },
  providerTags: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  locTag: {
    flexDirection: "row", alignItems: "center", gap: 2,
    backgroundColor: palette.background, borderRadius: r.full,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: HAIRLINE, borderColor: palette.border,
  },
  locTagText: { fontFamily: fontFamily.regular, fontSize: 10, color: palette.textSecondary },

  // Inclusions
  inclusionRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  checkCircle: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: palette.success,
    alignItems: "center", justifyContent: "center",
    marginTop: 2,
  },
  inclusionText: { fontFamily: fontFamily.regular, fontSize: 15, color: palette.textPrimary, flex: 1, lineHeight: 22 },

  // Add-ons
  addonRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8 },
  addonBorder: { borderTopWidth: HAIRLINE, borderTopColor: palette.border },
  addonIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: palette.primaryLight,
    alignItems: "center", justifyContent: "center",
  },
  addonName: { fontFamily: fontFamily.regular, fontSize: 14, color: palette.textPrimary, flex: 1 },
  addonPrice: { fontFamily: fontFamily.semiBold, fontSize: 13, color: palette.primary },

  // Good to know
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  infoIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: palette.background,
    alignItems: "center", justifyContent: "center",
    borderWidth: HAIRLINE, borderColor: palette.border,
    marginTop: 1,
  },
  infoText: { fontFamily: fontFamily.regular, fontSize: 14, color: palette.textSecondary, flex: 1, lineHeight: 20 },

  // Reviews
  reviewsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ratingBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: palette.warningLight,
    borderRadius: r.full,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  ratingBadgeText: { fontFamily: fontFamily.semiBold, fontSize: 13, color: palette.textPrimary },
  ratingBadgeCount: { fontFamily: fontFamily.regular, fontSize: 12, color: palette.textSecondary },

  reviewItem: { paddingTop: spacing.sm, gap: 4 },
  reviewTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reviewerChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  reviewerDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: palette.primaryLight,
    alignItems: "center", justifyContent: "center",
  },
  reviewerName: { fontFamily: fontFamily.medium, fontSize: 13, color: palette.textPrimary },
  reviewDate: { fontFamily: fontFamily.regular, fontSize: 11, color: palette.textDisabled },
  starsRow: { flexDirection: "row", gap: 2 },
  reviewComment: { fontFamily: fontFamily.regular, fontSize: 13, color: palette.textSecondary, lineHeight: 19 },

  emptyReviews: { alignItems: "center", paddingVertical: spacing.lg, gap: spacing.xs },
  emptyReviewsText: { fontFamily: fontFamily.regular, fontSize: 13, color: palette.textDisabled },

  divider: { height: HAIRLINE, backgroundColor: palette.border },
  seeAllRow: { paddingTop: spacing.sm, minHeight: 44, justifyContent: "center" },
  seeAllInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  seeAllText: { fontFamily: fontFamily.medium, fontSize: 14, color: palette.primary },

  // Bottom action bar
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
    backgroundColor: palette.surface,
    borderTopWidth: HAIRLINE,
    borderTopColor: palette.border,
  },
  bottomInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  bottomLeft: { gap: 1, minWidth: 80 },
  bottomFrom: { fontFamily: fontFamily.regular, fontSize: 11, color: palette.textSecondary },
  bottomPrice: { fontFamily: fontFamily.bold, fontSize: 22, color: palette.textPrimary },
  bottomPriceUnit: { fontFamily: fontFamily.regular, fontSize: 14, color: palette.textSecondary },
  bottomQuote: { fontFamily: fontFamily.medium, fontSize: 14, color: palette.textSecondary },
  ctaBtn: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: palette.primary,
    borderRadius: r.sm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
  },
  ctaBtnText: { fontFamily: fontFamily.semiBold, fontSize: 16, color: "#fff", letterSpacing: 0.2 },
});
