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
  AccessibilityInfo,
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { Text, TouchableRipple } from "react-native-paper";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { ApiError } from "../../api/errors";
import {
  Service,
  ServiceAddon,
  ServiceReview,
  StarDistEntry,
  servicesApi,
} from "../../api/services";
import { storageUrl } from "../../api/client";
import { BookingSheet } from "../../components/booking/BookingSheet";
import { MarkdownView } from "../../components/ui/MarkdownView";
import { SkeletonBlock } from "../../components/ui/SkeletonBlock";
import {
  EARNED_BADGE_META,
  VettingBadge,
} from "../../components/discovery/VettingBadge";
import { useSnackbar } from "../../providers/SnackbarProvider";
import { useLocationStore } from "../../store/locationStore";
import { palette, radius as r, shadow, spacing, typography } from "../../theme";

const SCREEN_W = Dimensions.get("window").width;
const GALLERY_H = 280;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatResponseTime(p50: number): string {
  if (p50 < 10) return "< 10 min";
  if (p50 < 30) return "< 30 min";
  if (p50 < 60) return "< 1 hr";
  if (p50 < 120) return "< 2 hrs";
  return "same day";
}

const LANG_LABELS: Record<string, string> = {
  en: "English",
  ny: "Nyanja",
  bem: "Bemba",
  ton: "Tonga",
};
const SUPPORTED_LANGS = new Set(["en", "ny", "bem", "ton"]);

// §6.2 quick-facts price tile label
function priceTileLabel(service: Service): string {
  if (service.pricing_model === "QUOTE") return "By quote";
  if (service.pricing_model === "HOURLY" && service.base_price != null) {
    return `ZMW ${service.base_price.toFixed(0)}/hr`;
  }
  return service.base_price != null
    ? `ZMW ${service.base_price.toFixed(0)}`
    : "—";
}

// Bottom bar CTA label.
// DIRECT mode: provider acceptance confirms the booking (not payment), so the
// CTA reads "Request booking" rather than "Book · {price}".
function ctaLabel(service: Service, liveTotal: number): string {
  if (service.pricing_model === "QUOTE") return "Request quote";
  if (service.payment_mode === "DIRECT") return "Request booking";
  if (service.pricing_model === "HOURLY") {
    return `Book · ZMW ${service.base_price?.toFixed(0) ?? "—"}/hr`;
  }
  return `Book · ZMW ${liveTotal.toFixed(0)}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Circular avatar with graceful initials fallback — never a broken image. */
function ProviderAvatar({
  avatarUrl,
  initials,
  size,
}: {
  avatarUrl: string | null;
  initials: string;
  size: number;
}) {
  const [failed, setFailed] = useState(false);

  if (avatarUrl && !failed) {
    return (
      <Image
        source={{ uri: storageUrl(avatarUrl) }}
        style={[
          styles.avatarImg,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
        contentFit="cover"
        cachePolicy="memory-disk"
        onError={() => setFailed(true)}
        accessibilityLabel="Provider photo"
      />
    );
  }

  return (
    <View
      style={[
        styles.avatarFallback,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.avatarInitials, { fontSize: size * 0.38 }]}>
        {initials}
      </Text>
    </View>
  );
}

/** Single quick-fact tile (price / duration / serves). */
function FactTile({
  icon,
  label,
  value,
  iconColor,
  small,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  iconColor?: string;
  small?: boolean;
}) {
  return (
    <View style={styles.factTile}>
      <Ionicons name={icon} size={18} color={iconColor ?? palette.primary} />
      <Text
        style={[styles.factValue, small && styles.factValueSm]}
        numberOfLines={2}
      >
        {value}
      </Text>
      <Text style={styles.factLabel}>{label}</Text>
    </View>
  );
}

/** One stat chip in the provider decision-stats row. */
function StatChip({
  icon,
  iconColor,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  iconColor: string;
  label: string;
}) {
  return (
    <View style={styles.statChip}>
      <Ionicons name={icon} size={12} color={iconColor} />
      <Text style={styles.statChipText}>{label}</Text>
    </View>
  );
}

/** Star distribution bar (rating breakdown chart). */
function StarBar({
  star,
  count,
  max,
}: {
  star: number;
  count: number;
  max: number;
}) {
  const pct = max > 0 ? count / max : 0;
  return (
    <View style={styles.starBarRow}>
      <View style={styles.starBarStars}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Ionicons
            key={i}
            name={i < star ? "star" : "star-outline"}
            size={10}
            color={i < star ? palette.warning : palette.textDisabled}
          />
        ))}
      </View>
      <View style={styles.starBarTrack}>
        <View
          style={[
            styles.starBarFill,
            { width: `${Math.round(pct * 100)}%` as any },
          ]}
        />
      </View>
      <Text style={styles.starBarCount}>{count}</Text>
    </View>
  );
}

/** Single review card. */
function ReviewCard({ review }: { review: ServiceReview }) {
  const stars = Math.round(review.rating);
  const date = new Date(review.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewerRow}>
          <View style={styles.reviewerAvatar}>
            <Ionicons
              name="person-outline"
              size={13}
              color={palette.textSecondary}
            />
          </View>
          <Text style={styles.reviewerName}>{review.reviewer.name}</Text>
        </View>
        <Text style={styles.reviewDate}>{date}</Text>
      </View>
      <View style={styles.starsRow}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Ionicons
            key={i}
            name={i < stars ? "star" : "star-outline"}
            size={13}
            color={i < stars ? palette.warning : palette.textDisabled}
          />
        ))}
      </View>
      {review.comment && (
        <Text style={styles.reviewComment} numberOfLines={4}>
          {review.comment}
        </Text>
      )}
    </View>
  );
}

/** Detail-screen skeleton while loading. */
function DetailSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <SkeletonBlock width="100%" height={GALLERY_H} radius={0} />
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <SkeletonBlock width="40%" height={14} />
        <SkeletonBlock width="85%" height={28} />
        <SkeletonBlock width="100%" height={72} radius={r.lg} />
        <SkeletonBlock width="100%" height={140} radius={r.lg} />
        <SkeletonBlock width="100%" height={100} radius={r.lg} />
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ServiceDetailScreen({ navigation, route }: any) {
  const serviceId: string = route.params?.serviceId;

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<number>>(
    new Set()
  );

  const { showError, showSnackbar } = useSnackbar();
  const { primaryLocation } = useLocationStore();
  const insets = useSafeAreaInsets();
  const carouselRef = useRef<FlatList>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await servicesApi.show(serviceId);
        setService(data);
      } catch (error) {
        showError(
          error instanceof ApiError ? error.message : "Failed to load service."
        );
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [serviceId]);

  // ── Live total ─────────────────────────────────────────────────────────────
  const addonTotal = useMemo(() => {
    if (!service) return 0;
    return (service.addons ?? [])
      .filter((a) => selectedAddonIds.has(a.id))
      .reduce((s, a) => s + a.price, 0);
  }, [service, selectedAddonIds]);

  const liveTotal = (service?.base_price ?? 0) + addonTotal;

  const selectedAddons: ServiceAddon[] = useMemo(
    () => (service?.addons ?? []).filter((a) => selectedAddonIds.has(a.id)),
    [service, selectedAddonIds]
  );

  // Politely announce total changes to screen readers
  const prevTotal = useRef(liveTotal);
  useEffect(() => {
    if (
      service &&
      service.pricing_model !== "QUOTE" &&
      prevTotal.current !== liveTotal
    ) {
      AccessibilityInfo.announceForAccessibility(
        `Total updated: ZMW ${liveTotal.toFixed(0)}`
      );
      prevTotal.current = liveTotal;
    }
  }, [liveTotal, service]);

  // ── Provider helpers ───────────────────────────────────────────────────────
  const provider = service?.provider ?? null;

  const providerInitials = useMemo(() => {
    const name = provider?.display_name ?? "";
    return (
      name
        .trim()
        .split(/\s+/)
        .map((w) => w[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase() || "?"
    );
  }, [provider?.display_name]);

  const yearsActive = provider?.year_started
    ? new Date().getFullYear() - provider.year_started
    : null;

  const responseLabel =
    provider?.response_time_p50_mins != null
      ? formatResponseTime(provider.response_time_p50_mins)
      : null;

  const supportedLangs = (provider?.languages ?? []).filter((l) =>
    SUPPORTED_LANGS.has(l)
  );

  // §4.4 — "Serves {location}" tile: service already passed candidacy filter;
  // tile confirms which delivery location it covers.
  const servesLabel = primaryLocation?.label ?? "your area";

  // ── Handlers ───────────────────────────────────────────────────────────────
  const toggleAddon = useCallback((id: number) => {
    setSelectedAddonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleShare = useCallback(async () => {
    if (!service) return;
    await Share.share({
      message: `Check out "${service.title}" on the service app.`,
    });
  }, [service]);

  const handleCta = useCallback(() => {
    if (!service) return;
    if (service.pricing_model === "QUOTE") {
      showSnackbar({
        message:
          "Quote requests are coming soon — the provider will send you a custom price.",
        variant: "info",
      });
      return;
    }
    setBookingOpen(true);
  }, [service]);

  // ── Reviews ────────────────────────────────────────────────────────────────
  const reviews: ServiceReview[] = service?.reviews ?? [];
  const starDist: StarDistEntry[] = service?.star_distribution ?? [];
  const reviewCount = service?.review_count ?? 0;
  const maxStarCount = starDist.reduce((m, r) => Math.max(m, r.count), 0);

  // Availability snippet — count active days from the provider's schedule matrix
  const activeDays = provider?.availability_matrix
    ? Object.values(provider.availability_matrix).filter(
        (slots) => slots.length > 0
      ).length
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading || !service) {
    return (
      <SafeAreaView style={styles.safe}>
        <DetailSkeleton />
      </SafeAreaView>
    );
  }

  const hasPhotos = (service.photos ?? []).length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 84 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. Photo gallery ─────────────────────────────────────────── */}
        <View style={styles.galleryWrapper}>
          {hasPhotos ? (
            <FlatList
              ref={carouselRef}
              data={service.photos}
              keyExtractor={(p) => String(p.id)}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                setPhotoIndex(
                  Math.round(e.nativeEvent.contentOffset.x / SCREEN_W)
                );
              }}
              scrollEventThrottle={16}
              accessible
              accessibilityLabel={`Service photo ${photoIndex + 1} of ${
                service.photos.length
              }`}
              renderItem={({ item }) => (
                <Image
                  source={{ uri: storageUrl(item.path) }}
                  style={styles.galleryImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={200}
                />
              )}
            />
          ) : (
            /* Flat category-tint fallback band */
            <View style={styles.galleryFallback}>
              <Ionicons
                name="construct-outline"
                size={48}
                color={palette.primary}
              />
            </View>
          )}

          {/* Overlay: back + share + save */}
          <View
            style={[
              styles.galleryOverlay,
              { paddingTop: insets.top + spacing.sm },
            ]}
          >
            <TouchableRipple
              onPress={() => navigation.goBack()}
              borderless
              style={styles.overlayBtn}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableRipple>

            <View style={styles.overlayRight}>
              <TouchableRipple
                onPress={handleShare}
                borderless
                style={styles.overlayBtn}
                accessibilityRole="button"
                accessibilityLabel="Share service"
              >
                <Ionicons name="share-outline" size={20} color="#fff" />
              </TouchableRipple>
              <TouchableRipple
                onPress={() => setSaved((s) => !s)}
                borderless
                style={styles.overlayBtn}
                accessibilityRole="togglebutton"
                accessibilityState={{ checked: saved }}
                accessibilityLabel={
                  saved ? "Remove from saved" : "Save service"
                }
              >
                <Ionicons
                  name={saved ? "heart" : "heart-outline"}
                  size={20}
                  color={saved ? "#F87171" : "#fff"}
                />
              </TouchableRipple>
            </View>
          </View>

          {/* Page dots + counter */}
          {hasPhotos && service.photos.length > 1 && (
            <View style={styles.galleryFooter}>
              <View style={styles.dotRow}>
                {service.photos.map((_, i) => (
                  <View
                    key={i}
                    style={[styles.dot, i === photoIndex && styles.dotActive]}
                  />
                ))}
              </View>
              <View style={styles.photoCounter}>
                <Text style={styles.photoCounterText}>
                  {photoIndex + 1} / {service.photos.length}
                </Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.body}>
          {/* ── 2. Title + category ──────────────────────────────────── */}
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>
              {service.category?.name ?? "Service"}
            </Text>
          </View>
          <Text style={styles.title}>{service.title}</Text>

          {/* ── 3. Quick-facts row ────────────────────────────────────── */}
          <View style={styles.factsCard}>
            <FactTile
              icon="cash-outline"
              label="Price"
              value={priceTileLabel(service)}
            />
            <View style={styles.factDivider} />
            <FactTile
              icon="time-outline"
              label="Duration"
              value={
                service.duration_estimate_mins
                  ? formatDuration(service.duration_estimate_mins)
                  : "—"
              }
            />
            <View style={styles.factDivider} />
            <FactTile
              icon="checkmark-circle-outline"
              label="Serves"
              value={servesLabel}
              iconColor={palette.success}
              small
            />
          </View>

          {/* ── 4. Provider card ──────────────────────────────────────── */}
          {provider && (
            <TouchableRipple
              borderless
              style={styles.providerCard}
              onPress={() =>
                navigation.navigate("ProviderProfile", {
                  providerId: provider.id,
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`View ${
                provider.display_name ?? "provider"
              }'s full profile`}
            >
              <View>
                {/* Header row: avatar + name/tier + chevron */}
                <View style={styles.providerHeader}>
                  <ProviderAvatar
                    avatarUrl={provider.avatar_url}
                    initials={providerInitials}
                    size={52}
                  />

                  <View style={styles.providerHeaderBody}>
                    <View style={styles.providerNameRow}>
                      <Text style={styles.providerName} numberOfLines={1}>
                        {provider.display_name ?? "Provider"}
                      </Text>
                      {provider.kyc_status === "VERIFIED" && (
                        <Ionicons
                          name="checkmark-circle"
                          size={16}
                          color={palette.success}
                          accessibilityLabel="Verified"
                        />
                      )}
                    </View>
                    <View style={styles.providerSubRow}>
                      <VettingBadge trustTier={provider.trust_tier} size="sm" />
                      {provider.base_location_label && (
                        <View style={styles.locationTag}>
                          <Ionicons
                            name="location-outline"
                            size={10}
                            color={palette.textSecondary}
                          />
                          <Text
                            style={styles.locationTagText}
                            numberOfLines={1}
                          >
                            {provider.base_location_label}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={palette.textDisabled}
                  />
                </View>

                {/* Decision stats row: rating · response · repeat · years */}
                <View style={styles.statsRow}>
                  <StatChip
                    icon="star"
                    iconColor={palette.warning}
                    label={`${provider.r_raw.toFixed(1)} (${
                      provider.v_reviews
                    })`}
                  />
                  {responseLabel && (
                    <StatChip
                      icon="flash-outline"
                      iconColor={palette.warning}
                      label={responseLabel}
                    />
                  )}
                  {provider.repeat_client_rate != null && (
                    <StatChip
                      icon="refresh-outline"
                      iconColor={palette.primary}
                      label={`${Math.round(
                        provider.repeat_client_rate * 100
                      )}% repeat`}
                    />
                  )}
                  {yearsActive != null && yearsActive > 0 && (
                    <StatChip
                      icon="calendar-outline"
                      iconColor={palette.textSecondary}
                      label={`${yearsActive} yr${yearsActive === 1 ? "" : "s"}`}
                    />
                  )}
                </View>

                {/* Earned badges (v3 §9.2) */}
                {(provider.badges ?? []).length > 0 && (
                  <View style={styles.badgeRow}>
                    {provider.badges.map((key) => {
                      const meta = EARNED_BADGE_META[key];
                      if (!meta) return null;
                      return (
                        <View
                          key={key}
                          style={[
                            styles.earnedBadge,
                            { backgroundColor: meta.color + "20" },
                          ]}
                        >
                          <Ionicons
                            name={meta.icon}
                            size={11}
                            color={meta.color}
                          />
                          <Text
                            style={[
                              styles.earnedBadgeText,
                              { color: meta.color },
                            ]}
                          >
                            {meta.label}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Bio snippet */}
                {provider.bio ? (
                  <Text style={styles.providerBio} numberOfLines={3}>
                    {provider.bio}
                  </Text>
                ) : null}

                {/* Credentials: Govt ID verified + certifications */}
                {(provider.kyc_status === "VERIFIED" ||
                  (provider.certifications ?? []).length > 0) && (
                  <View style={styles.credRow}>
                    {provider.kyc_status === "VERIFIED" && (
                      <View style={styles.credItem}>
                        <Ionicons
                          name="shield-checkmark-outline"
                          size={13}
                          color={palette.success}
                        />
                        <Text style={styles.credText}>Govt ID verified</Text>
                      </View>
                    )}
                    {(provider.certifications ?? [])
                      .slice(0, 2)
                      .map((cert, i) => {
                        const label =
                          typeof cert === "string"
                            ? cert
                            : (cert as any)?.name ??
                              (cert as any)?.title ??
                              "Certified";
                        return (
                          <View key={i} style={styles.credItem}>
                            <Ionicons
                              name="ribbon-outline"
                              size={13}
                              color={palette.primary}
                            />
                            <Text style={styles.credText} numberOfLines={1}>
                              {label}
                            </Text>
                          </View>
                        );
                      })}
                  </View>
                )}

                {/* Languages (en / ny / bem / ton only) */}
                {supportedLangs.length > 0 && (
                  <View style={styles.langsRow}>
                    <Ionicons
                      name="language-outline"
                      size={13}
                      color={palette.textSecondary}
                    />
                    <Text style={styles.langsText}>
                      {supportedLangs
                        .map((l) => LANG_LABELS[l] ?? l)
                        .join(" · ")}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableRipple>
          )}

          {/* ── 5. About this service ─────────────────────────────────── */}
          {service.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About this service</Text>
              <View style={styles.sectionCard}>
                <MarkdownView>{service.description}</MarkdownView>
              </View>
            </View>
          ) : null}

          {/* ── 6. What's included ───────────────────────────────────── */}
          {(service.inclusions ?? []).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>What's included</Text>
              <View style={styles.sectionCard}>
                {service.inclusions.map((item, i) => (
                  <View key={i} style={styles.inclusionRow}>
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={palette.success}
                    />
                    <Text style={styles.inclusionText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── 7. Add extras (selectable, live total) ───────────────── */}
          {(service.addons ?? []).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Add extras</Text>
              <View style={styles.sectionCard}>
                {service.addons.map((addon) => {
                  const selected = selectedAddonIds.has(addon.id);
                  return (
                    <TouchableRipple
                      key={addon.id}
                      onPress={() => toggleAddon(addon.id)}
                      style={[styles.addonRow, selected && styles.addonRowSel]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={`${
                        addon.name
                      }, ZMW ${addon.price.toFixed(0)}`}
                    >
                      <View style={styles.addonRowInner}>
                        <View
                          style={[
                            styles.addonCheck,
                            selected && styles.addonCheckSel,
                          ]}
                        >
                          {selected && (
                            <Ionicons name="checkmark" size={12} color="#fff" />
                          )}
                        </View>
                        <Text
                          style={[
                            styles.addonName,
                            selected && styles.addonNameSel,
                          ]}
                          numberOfLines={1}
                        >
                          {addon.name}
                        </Text>
                        <Text style={styles.addonPrice}>
                          + ZMW {addon.price.toFixed(0)}
                        </Text>
                      </View>
                    </TouchableRipple>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── 8. Availability snippet ───────────────────────────────── */}
          {activeDays != null && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Availability</Text>
              <View style={[styles.sectionCard, styles.availRow]}>
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={palette.primary}
                />
                <Text style={styles.availText}>
                  Available {activeDays} day{activeDays === 1 ? "" : "s"} a week
                </Text>
              </View>
            </View>
          )}

          {/* ── 9. Cancellation policy ────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cancellation</Text>
            <View style={[styles.sectionCard, styles.cancelRow]}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={palette.textSecondary}
              />
              <Text style={styles.cancelText}>
                {service.payment_mode === "DIRECT"
                  ? "You can cancel any time before the job starts at no cost — you only pay the provider directly once you've agreed. Frequent cancellations may affect your account."
                  : "Cancel before the job starts for a full refund. After the provider is en route, a cancellation fee may apply."}
              </Text>
            </View>
          </View>

          {/* ── 10. Reviews ──────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Reviews{reviewCount > 0 ? ` (${reviewCount})` : ""}
            </Text>

            {reviewCount === 0 ? (
              <View style={styles.emptyReviews}>
                <Ionicons
                  name="chatbubble-outline"
                  size={28}
                  color={palette.textDisabled}
                />
                <Text style={styles.emptyReviewsText}>No reviews yet</Text>
              </View>
            ) : (
              <>
                {/* Overall rating + star distribution */}
                <View style={[styles.sectionCard, styles.ratingOverview]}>
                  <View style={styles.ratingOverviewLeft}>
                    <Text style={styles.ratingBig}>
                      {(service.provider?.r_raw ?? 0).toFixed(1)}
                    </Text>
                    <View style={styles.ratingStarsRow}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Ionicons
                          key={i}
                          name={
                            i < Math.round(service.provider?.r_raw ?? 0)
                              ? "star"
                              : "star-outline"
                          }
                          size={14}
                          color={palette.warning}
                        />
                      ))}
                    </View>
                    <Text style={styles.ratingCount}>
                      {reviewCount} review{reviewCount === 1 ? "" : "s"}
                    </Text>
                  </View>

                  <View style={styles.ratingBars}>
                    {[5, 4, 3, 2, 1].map((star) => {
                      const entry = starDist.find((d) => d.star === star);
                      return (
                        <StarBar
                          key={star}
                          star={star}
                          count={entry?.count ?? 0}
                          max={maxStarCount}
                        />
                      );
                    })}
                  </View>
                </View>

                {/* Review cards (up to 5 from detail endpoint) */}
                {reviews.map((rev) => (
                  <ReviewCard key={rev.id} review={rev} />
                ))}

                {reviewCount > reviews.length && (
                  <TouchableRipple
                    onPress={() =>
                      navigation.navigate("ProviderProfile", {
                        providerId: service.provider_id,
                      })
                    }
                    style={styles.seeAllBtn}
                    accessibilityRole="button"
                  >
                    <Text style={styles.seeAllText}>
                      See all {reviewCount} reviews
                    </Text>
                  </TouchableRipple>
                )}
              </>
            )}
          </View>
        </View>
      </ScrollView>

      {/* ── Sticky bottom bar (in-frame, not position:fixed) ─────────── */}
      <View
        style={[styles.bottomBar, { paddingBottom: spacing.sm }]}
        accessibilityLiveRegion="polite"
      >
        <TouchableRipple
          onPress={handleCta}
          style={[
            styles.ctaBtn,
            service.pricing_model === "QUOTE" && styles.ctaBtnFull,
          ]}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel(service, liveTotal)}
        >
          <Text style={styles.ctaBtnText}>{ctaLabel(service, liveTotal)}</Text>
        </TouchableRipple>
      </View>

      {/* BookingSheet — carries selected add-ons + delivery location into checkout */}
      {service.base_price != null && (
        <BookingSheet
          visible={bookingOpen}
          onClose={() => setBookingOpen(false)}
          serviceId={service.id}
          serviceTitle={service.title}
          basePrice={service.base_price}
          pricingModel={service.pricing_model}
          paymentMode={service.payment_mode}
          availabilityMatrix={service.provider?.availability_matrix}
          selectedAddons={selectedAddons}
          onBooked={(bookingId) =>
            navigation.navigate("BookingDetail", { bookingId })
          }
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  skeletonWrap: { flex: 1 },

  // ── Gallery ────────────────────────────────────────────────────────────────
  galleryWrapper: {
    width: SCREEN_W,
    height: GALLERY_H,
    backgroundColor: palette.primaryLight,
  },
  galleryImage: { width: SCREEN_W, height: GALLERY_H },
  galleryFallback: {
    width: SCREEN_W,
    height: GALLERY_H,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primaryLight,
  },
  galleryOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
  },
  galleryFooter: {
    position: "absolute",
    bottom: spacing.sm,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  overlayBtn: {
    width: 40,
    height: 40,
    borderRadius: r.full,
    backgroundColor: "#00000055",
    alignItems: "center",
    justifyContent: "center",
  },
  overlayRight: { flexDirection: "row", gap: spacing.xs },
  dotRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ffffff66" },
  dotActive: { width: 18, backgroundColor: "#fff" },
  photoCounter: {
    backgroundColor: "#00000055",
    borderRadius: r.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  photoCounterText: {
    fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 11,
    color: "#fff",
  },

  // ── Body ───────────────────────────────────────────────────────────────────
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  categoryBadge: {
    alignSelf: "flex-start",
    backgroundColor: palette.primaryLight,
    borderRadius: r.full,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  categoryText: {
    ...typography.bodySmall,
    color: palette.primary,
    fontSize: 12,
  },
  title: {
    ...typography.heading2,
    color: palette.textPrimary,
    marginBottom: spacing.md,
  },

  // ── Quick-facts ────────────────────────────────────────────────────────────
  factsCard: {
    flexDirection: "row",
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.md,
    // ...shadow.card,
  },
  factTile: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    gap: 4,
  },
  factDivider: {
    width: 1,
    backgroundColor: palette.border,
    marginVertical: spacing.sm,
  },
  factValue: {
    ...typography.label,
    color: palette.textPrimary,
    fontSize: 13,
    textAlign: "center",
  },
  factValueSm: { fontSize: 11 },
  factLabel: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 10,
    textAlign: "center",
  },

  // ── Provider card ──────────────────────────────────────────────────────────
  providerCard: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.md,
    padding: spacing.md,
    overflow: "hidden",
    // ...shadow.card,
  },
  providerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  providerHeaderBody: { flex: 1 },
  providerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  providerName: {
    ...typography.label,
    color: palette.textPrimary,
    fontSize: 16,
    flex: 1,
  },
  providerSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },

  // Avatar
  avatarImg: { borderWidth: 1, borderColor: palette.border },
  avatarFallback: {
    backgroundColor: palette.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.border,
  },
  avatarInitials: {
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: palette.primary,
  },

  locationTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: palette.background,
    borderRadius: r.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: palette.border,
  },
  locationTagText: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 10,
  },

  // Decision stats
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  statChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: palette.background,
    borderRadius: r.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: palette.border,
  },
  statChipText: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 11,
  },

  // Earned badges
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  earnedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: r.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  earnedBadgeText: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 11 },

  // Bio
  providerBio: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },

  // Credentials
  credRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  credItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: palette.background,
    borderRadius: r.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: palette.border,
    maxWidth: "60%",
  },
  credText: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 11,
  },

  // Languages
  langsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  langsText: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 12,
  },

  // ── Generic section ────────────────────────────────────────────────────────
  section: { marginBottom: spacing.md },
  sectionTitle: {
    ...typography.label,
    color: palette.textPrimary,
    marginBottom: spacing.xs,
  },
  sectionCard: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    // ...shadow.card,
  },

  // ── Inclusions ─────────────────────────────────────────────────────────────
  inclusionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: 5,
  },
  inclusionText: {
    ...typography.body,
    color: palette.textPrimary,
    fontSize: 15,
    flex: 1,
  },

  // ── Add-ons ────────────────────────────────────────────────────────────────
  addonRow: {
    borderRadius: r.md,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden",
  },
  addonRowSel: {
    borderColor: palette.primary,
    backgroundColor: palette.primaryLight,
  },
  addonRowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm + 2,
    minHeight: 44,
  },
  addonCheck: {
    width: 20,
    height: 20,
    borderRadius: r.sm,
    borderWidth: 1.5,
    borderColor: palette.textDisabled,
    alignItems: "center",
    justifyContent: "center",
  },
  addonCheckSel: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  addonName: {
    ...typography.body,
    color: palette.textPrimary,
    fontSize: 14,
    flex: 1,
  },
  addonNameSel: { color: palette.primary },
  addonPrice: { ...typography.label, color: palette.primary, fontSize: 13 },

  // ── Availability ───────────────────────────────────────────────────────────
  availRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  availText: { ...typography.body, color: palette.textPrimary, fontSize: 14 },

  // ── Cancellation ───────────────────────────────────────────────────────────
  cancelRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  cancelText: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    flex: 1,
    lineHeight: 20,
  },

  // ── Reviews ────────────────────────────────────────────────────────────────
  emptyReviews: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.xs,
  },
  emptyReviewsText: { ...typography.bodySmall, color: palette.textDisabled },

  ratingOverview: {
    flexDirection: "row",
    gap: spacing.lg,
    marginBottom: spacing.sm,
  },
  ratingOverviewLeft: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  ratingBig: {
    fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 36,
    color: palette.textPrimary,
  },
  ratingStarsRow: { flexDirection: "row", gap: 2 },
  ratingCount: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 11,
  },
  ratingBars: { flex: 1, gap: 4, justifyContent: "center" },

  starBarRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  starBarStars: { flexDirection: "row", gap: 1 },
  starBarTrack: {
    flex: 1,
    height: 5,
    backgroundColor: palette.border,
    borderRadius: r.full,
    overflow: "hidden",
  },
  starBarFill: {
    height: "100%",
    backgroundColor: palette.warning,
    borderRadius: r.full,
  },
  starBarCount: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 11,
    width: 22,
    textAlign: "right",
  },

  reviewCard: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    // ...shadow.card,
  },
  reviewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  reviewerRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  reviewerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: palette.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewerName: {
    ...typography.label,
    color: palette.textPrimary,
    fontSize: 13,
  },
  reviewDate: {
    ...typography.bodySmall,
    color: palette.textDisabled,
    fontSize: 11,
  },
  starsRow: { flexDirection: "row", gap: 2, marginBottom: spacing.xs },
  reviewComment: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    lineHeight: 20,
  },

  seeAllBtn: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  seeAllText: { ...typography.label, color: palette.primary, fontSize: 14 },

  // ── Sticky bottom bar (in-frame, not position:fixed) ──────────────────────
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  bottomPriceBlock: { gap: 1 },
  bottomPriceLabel: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 11,
  },
  bottomPrice: {
    fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 20,
    color: palette.textPrimary,
  },

  ctaBtn: {
    flex: 1,
    backgroundColor: palette.primary,
    borderRadius: r.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    overflow: "hidden",
  },
  ctaBtnFull: { flex: 1 },
  ctaBtnText: {
    fontFamily: "PlusJakartaSans_600SemiBold",
    fontSize: 16,
    color: "#fff",
    letterSpacing: 0.2,
  },
});
