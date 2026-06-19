import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, FlatList, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { storageUrl } from '../../api/client';
import { ApiError } from '../../api/errors';
import { PublicProviderProfile, PublicReview, PublicService, providersApi } from '../../api/providers';
import { BookingSheet } from '../../components/booking/BookingSheet';
import { EARNED_BADGE_META, VettingBadge } from '../../components/discovery/VettingBadge';
import {
  RankedCardData,
  RankedServiceCard,
} from '../../components/discovery/RankedServiceCard';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { SkeletonBlock } from '../../components/ui/SkeletonBlock';
import { TabItem, Tabs } from '../../components/ui/Tabs';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { palette, radius as r, spacing, typography } from '../../theme';
import { fontFamily } from '../../theme/typography';

// ── Helpers ──────────────────────────────────────────────────────────────────

const HAIRLINE = StyleSheet.hairlineWidth;

const LANG_LABELS: Record<string, string> = { en: 'English', ny: 'Nyanja', bem: 'Bemba', ton: 'Tonga' };

function resolveImg(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith('http') ? path : storageUrl(path);
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
}

function fmtResponse(mins: number | null): string {
  if (mins == null) return '–';
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

// Map a slim PublicService onto the canonical RankedServiceCard shape. Provider
// trust signals come from the profile so the shared card renders faithfully;
// distance is null (no coordinates), completed_job_count null (no rising-star on
// a provider's own page), DIRECT-mode pilot.
function publicServiceToCard(svc: PublicService, profile: PublicProviderProfile): RankedCardData {
  return {
    id:            svc.id,
    title:         svc.title,
    pricing_model: svc.pricing_model,
    base_price:    svc.base_price,
    payment_mode:  'DIRECT',
    category:      { id: svc.category.id, name: svc.category.name, icon: null },
    photoPath:     null,
    distance_km:   null,
    placement:     'organic',
    completed_job_count: null,
    provider: {
      display_name:           profile.display_name,
      avatar_url:             resolveImg(profile.avatar_url),
      r_raw:                  profile.r_raw,
      v_reviews:              profile.v_reviews,
      trust_tier:             profile.trust_tier,
      response_time_p50_mins: profile.response_time_p50_mins,
    },
  };
}

type TabKey = 'services' | 'about' | 'reviews';
const REVIEW_PREVIEW = 5;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ── Full-screen image lightbox ────────────────────────────────────────────────

function WorksLightbox({
  images,
  startIndex,
  visible,
  onClose,
}: {
  images: string[];   // fully resolved URIs
  startIndex: number;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);
  const [current, setCurrent] = useState(startIndex);

  // Sync index and scroll position each time the lightbox opens
  useEffect(() => {
    if (!visible) return;
    setCurrent(startIndex);
    // FlatList needs one tick to mount before scrollToIndex works
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: startIndex, animated: false });
    }, 30);
    return () => clearTimeout(t);
  }, [visible, startIndex]);

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={lbStyles.root}>
        {/* Header: counter + close */}
        <View style={[lbStyles.header, { paddingTop: insets.top + spacing.xs }]}>
          <Text style={lbStyles.counter}>{current + 1} / {images.length}</Text>
          <TouchableOpacity
            onPress={onClose}
            style={lbStyles.closeBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Paginated full-screen image strip */}
        <FlatList
          ref={listRef}
          data={images}
          keyExtractor={(uri) => uri}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={startIndex}
          getItemLayout={(_, index) => ({
            length: SCREEN_W,
            offset: SCREEN_W * index,
            index,
          })}
          onMomentumScrollEnd={(e) => {
            setCurrent(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
          }}
          renderItem={({ item: uri }) => (
            <View style={lbStyles.slide}>
              <Image
                source={{ uri }}
                style={lbStyles.fullImg}
                contentFit="contain"
                cachePolicy="memory-disk"
                accessibilityLabel="Work photo"
              />
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

const lbStyles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#000' },
  header:   {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  counter:  { fontFamily: fontFamily.medium, fontSize: 14, color: '#fff' },
  closeBtn: {
    width: 40, height: 40, borderRadius: r.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  slide:    { width: SCREEN_W, height: SCREEN_H, justifyContent: 'center' },
  fullImg:  { width: SCREEN_W, height: SCREEN_H },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ProviderProfileScreen({ route, navigation }: any) {
  const { providerId } = route.params as { providerId: string };
  const { showError } = useSnackbar();

  const [profile,  setProfile]  = useState<PublicProviderProfile | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [offline,  setOffline]  = useState(false);
  const [tab,      setTab]      = useState<TabKey>('services');
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [bookingFor, setBookingFor] = useState<PublicService | null>(null);
  const [lbImages, setLbImages] = useState<string[]>([]);
  const [lbIndex, setLbIndex] = useState(0);
  const [lbOpen, setLbOpen] = useState(false);

  const scrollRef  = useRef<ScrollView>(null);
  const headerH    = useRef(0);

  const load = useCallback(async () => {
    try {
      const data = await providersApi.getProfile(providerId);
      setProfile(data);
      setOffline(false);
    } catch (e) {
      const apiErr = e instanceof ApiError ? e : null;
      const isNetwork = apiErr?.message?.toLowerCase().includes('network');
      // Keep the last-good profile visible behind an offline notice; only bail
      // out to an error state when we have nothing cached to show.
      if (isNetwork && profile) {
        setOffline(true);
      } else {
        showError(apiErr?.message ?? 'Failed to load profile.');
        if (!profile) navigation.goBack();
      }
    } finally {
      setLoading(false);
    }
  }, [providerId, profile, navigation, showError]);

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  // Tab switch resets scroll back to the (sticky) tab strip.
  const onTabChange = (key: string) => {
    Haptics.selectionAsync();
    setTab(key as TabKey);
    setShowAllReviews(false);
    scrollRef.current?.scrollTo({ y: headerH.current, animated: false });
  };

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ProfileSkeleton />
      </SafeAreaView>
    );
  }
  if (!profile) return <SafeAreaView style={styles.safe} edges={['top']} />;

  const displayName = profile.display_name ?? 'Provider';
  const avatar      = resolveImg(profile.avatar_url);
  const cover       = resolveImg(profile.cover_image_url);
  const isVerified  = profile.trust_tier >= 2;

  // Badges: provider-featured first, then the rest of what they've earned.
  const featured = profile.highlights?.featured_badges ?? [];
  const badges = [
    ...featured,
    ...(profile.earned_badges ?? []).filter((b) => !featured.includes(b)),
  ];

  // Services: pinned/highlighted first, then the rest (active only — backend).
  const services = [...(profile.services ?? [])].sort(
    (a, b) => Number(b.is_pinned) - Number(a.is_pinned),
  );

  const tabs: TabItem[] = [
    { key: 'services', label: 'Services', count: services.length },
    { key: 'about',    label: 'About' },
    { key: 'reviews',  label: 'Reviews', count: profile.v_reviews },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {offline && (
        <View style={styles.offlineBar}>
          <Ionicons name="cloud-offline-outline" size={14} color={palette.warning} />
          <Text style={styles.offlineTxt}>Offline — showing saved profile</Text>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
      >
        {/* ── [0] Persistent header ───────────────────────────────── */}
        <View onLayout={(e) => { headerH.current = e.nativeEvent.layout.height; }}>
          {/* Cover band (flat — image or solid tint, no gradient/shadow) */}
          <View style={styles.cover}>
            {cover && (
              <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
            )}
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => navigation.goBack()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={22} color={palette.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Identity */}
          <View style={styles.identity}>
            {/* Public profile photo — prominent, circular, initials fallback.
                Never the private KYC selfie (avatar_url is the public photo). */}
            <View style={styles.avatarRing}>
              {avatar ? (
                <Image
                  source={{ uri: avatar }}
                  style={styles.avatar}
                  contentFit="cover"
                  transition={150}
                  accessibilityLabel={`${displayName}'s profile photo`}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitials}>{initialsOf(displayName)}</Text>
                </View>
              )}
            </View>

            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              {isVerified && (
                <Ionicons name="checkmark-circle" size={18} color={palette.success} accessibilityLabel="Verified provider" />
              )}
            </View>

            <View style={styles.tierRow}>
              <VettingBadge trustTier={profile.trust_tier} size="md" />
              {!!profile.base_location_label && (
                <View style={styles.locRow}>
                  <Ionicons name="location-outline" size={13} color={palette.textSecondary} />
                  <Text style={styles.locTxt} numberOfLines={1}>{profile.base_location_label}</Text>
                </View>
              )}
            </View>

            {/* Trust stats — value + label as text (never colour alone) */}
            <View style={styles.stats}>
              <Stat
                value={profile.v_reviews > 0 ? profile.r_raw.toFixed(1) : '–'}
                sub={profile.v_reviews > 0 ? `(${profile.v_reviews})` : undefined}
                label="Rating"
              />
              <View style={styles.statDivider} />
              <Stat value={fmtResponse(profile.response_time_p50_mins)} label="Replies in" />
              <View style={styles.statDivider} />
              <Stat
                value={profile.repeat_client_rate != null ? `${Math.round(profile.repeat_client_rate * 100)}%` : '–'}
                label="Repeat clients"
              />
              <View style={styles.statDivider} />
              <Stat value={yearsActive(profile.year_started)} label="Years active" />
            </View>

            {/* Earned badges (§9.2) */}
            {badges.length > 0 && (
              <View style={styles.badgeRow}>
                {badges.map((key) => {
                  const meta = EARNED_BADGE_META[key];
                  if (!meta) return null;
                  return (
                    <View key={key} style={styles.badgeChip} accessibilityLabel={`Badge: ${meta.label}`}>
                      <Ionicons name={meta.icon as any} size={12} color={meta.color} />
                      <Text style={styles.badgeChipTxt}>{meta.label}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>

        {/* ── [1] Sticky tab strip ────────────────────────────────── */}
        <View style={styles.tabsWrap}>
          <Tabs items={tabs} activeKey={tab} onChange={onTabChange} />
        </View>

        {/* ── [2] Tab content ─────────────────────────────────────── */}
        <View style={styles.content}>
          {tab === 'services' && (
            <ServicesTab
              services={services}
              profile={profile}
              onOpen={(id) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                navigation.navigate('ServiceDetail', { serviceId: id });
              }}
              onBook={(svc) => setBookingFor(svc)}
            />
          )}
          {tab === 'about'    && (
            <AboutTab
              profile={profile}
              onImagePress={(imgs, idx) => { setLbImages(imgs); setLbIndex(idx); setLbOpen(true); }}
            />
          )}
          {tab === 'reviews'  && (
            <ReviewsTab
              profile={profile}
              showAll={showAllReviews}
              onSeeAll={() => navigation.navigate('AllReviews', {
                providerId:   profile.id,
                providerName: profile.display_name,
                avatarUrl:    profile.avatar_url,
                trustTier:    profile.trust_tier,
              })}
            />
          )}
        </View>
      </ScrollView>

      <WorksLightbox
        images={lbImages}
        startIndex={lbIndex}
        visible={lbOpen}
        onClose={() => setLbOpen(false)}
      />

      {/* Booking modal (DIRECT → "Request booking") */}
      <BookingSheet
        visible={!!bookingFor}
        onClose={() => setBookingFor(null)}
        serviceId={bookingFor?.id ?? ''}
        serviceTitle={bookingFor?.title ?? ''}
        basePrice={bookingFor?.base_price ?? 0}
        pricingModel={bookingFor?.pricing_model}
        paymentMode="DIRECT"
        availabilityMatrix={profile.profile.availability_matrix}
        categoryId={bookingFor?.category.id}
        providerName={profile.display_name}
        onBooked={(bookingId) => {
          setBookingFor(null);
          navigation.navigate('BookingDetail', { bookingId });
        }}
      />
    </SafeAreaView>
  );
}

function yearsActive(yearStarted: number | null): string {
  if (!yearStarted) return '–';
  const yrs = new Date().getFullYear() - yearStarted;
  if (yrs <= 0) return 'New';
  return `${yrs}y`;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function ServicesTab({
  services, profile, onOpen, onBook,
}: {
  services: PublicService[];
  profile:  PublicProviderProfile;
  onOpen:   (id: string) => void;
  onBook:   (svc: PublicService) => void;
}) {
  if (services.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="briefcase-outline" size={36} color={palette.textDisabled} />
        <Text style={styles.emptyTxt}>No active services listed yet.</Text>
      </View>
    );
  }
  return (
    <View>
      {services.map((svc) => (
        <RankedServiceCard
          key={svc.id}
          data={publicServiceToCard(svc, profile)}
          saved={false}
          onPress={() => onOpen(svc.id)}
          onBook={() => onBook(svc)}
          onToggleSave={() => {}}
        />
      ))}
    </View>
  );
}

function AboutTab({ profile, onImagePress }: {
  profile: PublicProviderProfile;
  onImagePress: (images: string[], index: number) => void;
}) {
  const languages = (profile.languages ?? []).map((c) => LANG_LABELS[c] ?? c);
  const rawPortfolio = [
    ...(profile.highlights?.featured_photo_keys ?? []),
    ...(profile.portfolio_images ?? []).filter(
      (p) => !(profile.highlights?.featured_photo_keys ?? []).includes(p),
    ),
  ];
  // Pre-resolve to full URIs so the lightbox receives ready-to-use strings
  const portfolio = rawPortfolio.map((p) => resolveImg(p) ?? p);
  const isVerified = profile.trust_tier >= 2;

  return (
    <View>
      {/* Bio */}
      {!!profile.bio && (
        <Section title="About">
          <MarkdownView>{profile.bio}</MarkdownView>
        </Section>
      )}

      {/* Languages */}
      {languages.length > 0 && (
        <Section title="Languages">
          <View style={styles.chipWrap}>
            {languages.map((l) => (
              <View key={l} style={styles.langChip}>
                <Text style={styles.langChipTxt}>{l}</Text>
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* Verified credentials (Govt ID marker; certifications not in public payload) */}
      {isVerified && (
        <Section title="Verified credentials">
          <View style={styles.credBlock}>
            <Ionicons name="shield-checkmark" size={18} color={palette.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.credTitle}>Government ID verified</Text>
              <Text style={styles.credSub}>Identity confirmed by our team</Text>
            </View>
          </View>
        </Section>
      )}

      {/* Portfolio carousel — bleeds edge-to-edge */}
      {portfolio.length > 0 && (
        <View style={styles.portfolioSection}>
          <Text style={styles.sectionTitle}>Work done ({portfolio.length})</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.portfolioCarousel}
            style={styles.portfolioCarouselOuter}
          >
            {portfolio.map((uri, idx) => (
              <TouchableOpacity
                key={`${uri}-${idx}`}
                onPress={() => onImagePress(portfolio, idx)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`View work photo ${idx + 1} of ${portfolio.length}`}
              >
                <Image
                  source={{ uri: uri || undefined }}
                  style={styles.portfolioThumb}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={150}
                />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {!profile.bio && languages.length === 0 && !isVerified && portfolio.length === 0 && (
        <View style={styles.empty}>
          <Ionicons name="information-circle-outline" size={36} color={palette.textDisabled} />
          <Text style={styles.emptyTxt}>This provider hasn’t added details yet.</Text>
        </View>
      )}
    </View>
  );
}

function ReviewsTab({
  profile, showAll, onSeeAll,
}: {
  profile:  PublicProviderProfile;
  showAll:  boolean;
  onSeeAll: () => void;
}) {
  const reviews = profile.reviews ?? [];
  const loaded  = reviews.length;
  // Star distribution computed from the loaded reviews (§7.1 display).
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((rv) => Math.round(rv.rating) === star).length,
  }));
  const shown = showAll ? reviews : reviews.slice(0, REVIEW_PREVIEW);

  return (
    <View>
      {/* Overall — stats always shown, even with zero reviews */}
      <View style={styles.overall}>
        <View style={styles.overallLeft}>
          <Text style={styles.overallScore}>{profile.v_reviews > 0 ? profile.r_raw.toFixed(1) : '–'}</Text>
          <View style={styles.starsRow} accessibilityLabel={`${profile.r_raw.toFixed(1)} out of 5`}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Ionicons
                key={i}
                name={i < Math.round(profile.r_raw) && profile.v_reviews > 0 ? 'star' : 'star-outline'}
                size={13}
                color={i < Math.round(profile.r_raw) && profile.v_reviews > 0 ? palette.warning : palette.textDisabled}
              />
            ))}
          </View>
          <Text style={styles.overallCount}>{profile.v_reviews} {profile.v_reviews === 1 ? 'review' : 'reviews'}</Text>
        </View>
        <View style={styles.dist}>
          {dist.map((d) => (
            <View key={d.star} style={styles.distRow}>
              <Text style={styles.distStar}>{d.star}</Text>
              <Ionicons name="star" size={10} color={palette.textDisabled} />
              <View style={styles.distTrack}>
                <View style={[styles.distFill, { width: `${loaded ? (d.count / loaded) * 100 : 0}%` }]} />
              </View>
              <Text style={styles.distCount}>{d.count}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.divider} />

      {loaded === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubble-ellipses-outline" size={36} color={palette.textDisabled} />
          <Text style={styles.emptyTxt}>No reviews yet</Text>
        </View>
      ) : (
        <>
          {shown.map((rev) => <ReviewCard key={rev.id} review={rev} />)}
          {!showAll && profile.v_reviews > REVIEW_PREVIEW && (
            <TouchableRipple onPress={onSeeAll} borderless style={styles.seeAll} accessibilityRole="button">
              <Text style={styles.seeAllTxt}>See all {profile.v_reviews} reviews</Text>
            </TouchableRipple>
          )}
        </>
      )}
    </View>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────────

function Stat({ value, sub, label }: { value: string; sub?: string; label: string }) {
  return (
    <View style={styles.statCell} accessibilityLabel={`${label}: ${value}${sub ? ` ${sub}` : ''}`}>
      <View style={styles.statValueRow}>
        <Text style={styles.statValue}>{value}</Text>
        {!!sub && <Text style={styles.statSub}>{sub}</Text>}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ReviewCard({ review }: { review: PublicReview }) {
  const stars = Math.round(review.rating);
  const date  = new Date(review.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewerRow}>
          <View style={styles.reviewerAvatar}>
            <Text style={styles.reviewerInitials}>{initialsOf(review.reviewer.name)}</Text>
          </View>
          <Text style={styles.reviewerName}>{review.reviewer.name}</Text>
        </View>
        <Text style={styles.reviewDate}>{date}</Text>
      </View>
      <View style={styles.starsRow} accessibilityLabel={`${stars} out of 5 stars`}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Ionicons key={i} name={i < stars ? 'star' : 'star-outline'} size={13} color={i < stars ? palette.warning : palette.textDisabled} />
        ))}
      </View>
      {!!review.comment && <Text style={styles.reviewComment}>{review.comment}</Text>}
    </View>
  );
}

function ProfileSkeleton() {
  return (
    <View>
      <View style={styles.cover} />
      <View style={styles.identity}>
        <View style={[styles.avatarRing, { marginTop: -56 }]}>
          <SkeletonBlock width={88} height={88} radius={r.full} />
        </View>
        <SkeletonBlock width="55%" height={22} style={{ marginTop: spacing.sm, alignSelf: 'center' }} />
        <SkeletonBlock width="40%" height={14} style={{ marginTop: spacing.sm, alignSelf: 'center' }} />
        <SkeletonBlock width="100%" height={64} radius={r.sm} style={{ marginTop: spacing.md }} />
      </View>
      <View style={styles.content}>
        {[1, 2, 3].map((k) => (
          <SkeletonBlock key={k} width="100%" height={92} radius={r.sm} style={{ marginBottom: spacing.sm }} />
        ))}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const AVATAR = 88;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  offlineBar: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             spacing.xs,
    backgroundColor: palette.warningLight,
    paddingVertical: spacing.xs,
  },
  offlineTxt: { fontFamily: fontFamily.regular, fontSize: 12, color: palette.warning },

  // Cover band — flat tint (or image), no gradient, no shadow
  cover: {
    height:          104,
    backgroundColor: palette.primaryLight,
    overflow:        'hidden',
  },
  backBtn: {
    position:        'absolute',
    top:             spacing.sm,
    left:            spacing.sm,
    width:           40,
    height:          40,
    borderRadius:    r.full,
    backgroundColor: palette.surface,
    borderWidth:     HAIRLINE,
    borderColor:     palette.border,
    alignItems:      'center',
    justifyContent:  'center',
  },

  // Identity block
  identity: {
    paddingHorizontal: spacing.lg,
    paddingBottom:     spacing.md,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: palette.border,
    backgroundColor:   palette.surface,
  },
  avatarRing: {
    width:           AVATAR + 6,
    height:          AVATAR + 6,
    borderRadius:    r.full,
    backgroundColor: palette.surface,
    borderWidth:     HAIRLINE,
    borderColor:     palette.border,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       -((AVATAR + 6) / 2),
  },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: r.full },
  avatarFallback: { backgroundColor: palette.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontFamily: fontFamily.bold, fontSize: 28, color: palette.primary },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  name:    { ...typography.heading2, color: palette.textPrimary, flexShrink: 1 },

  tierRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' },
  locRow:  { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  locTxt:  { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12, flexShrink: 1 },

  // Trust stats
  stats: {
    flexDirection:   'row',
    alignItems:      'stretch',
    marginTop:       spacing.md,
    borderWidth:     HAIRLINE,
    borderColor:     palette.border,
    borderRadius:    r.sm,
    backgroundColor: palette.background,
  },
  statCell:     { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, gap: 2 },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  statValue:    { fontFamily: fontFamily.bold, fontSize: 15, color: palette.textPrimary },
  statSub:      { fontFamily: fontFamily.regular, fontSize: 11, color: palette.textSecondary },
  statLabel:    { fontFamily: fontFamily.regular, fontSize: 10, color: palette.textSecondary },
  statDivider:  { width: HAIRLINE, backgroundColor: palette.border, marginVertical: spacing.sm },

  // Earned badges
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  badgeChip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    borderWidth:       HAIRLINE,
    borderColor:       palette.border,
    borderRadius:      r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical:   4,
    backgroundColor:   palette.surface,
  },
  badgeChipTxt: { fontFamily: fontFamily.medium, fontSize: 11, color: palette.textPrimary },

  // Tabs strip (sticky)
  tabsWrap: { backgroundColor: palette.surface },

  // Tab content
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  section:      { marginBottom: spacing.lg },
  sectionTitle: { fontFamily: fontFamily.semiBold, fontSize: 15, color: palette.textPrimary, marginBottom: spacing.sm },

  divider: { height: HAIRLINE, backgroundColor: palette.border, marginVertical: spacing.md },

  // Languages
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  langChip: {
    borderWidth:       HAIRLINE,
    borderColor:       palette.border,
    borderRadius:      r.full,
    paddingHorizontal: spacing.md,
    paddingVertical:   6,
    backgroundColor:   palette.surface,
  },
  langChipTxt: { fontFamily: fontFamily.regular, fontSize: 13, color: palette.textPrimary },

  // Verified credentials
  credBlock: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing.sm,
    borderWidth:     HAIRLINE,
    borderColor:     palette.border,
    borderRadius:    r.sm,
    backgroundColor: palette.surface,
    padding:         spacing.md,
  },
  credTitle: { fontFamily: fontFamily.medium, fontSize: 14, color: palette.textPrimary },
  credSub:   { fontFamily: fontFamily.regular, fontSize: 12, color: palette.textSecondary, marginTop: 1 },

  // Portfolio carousel (edge-to-edge)
  portfolioSection: { marginBottom: spacing.lg },
  portfolioCarouselOuter: {
    marginHorizontal: -spacing.lg,
    marginTop: spacing.sm,
  },
  portfolioCarousel: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  portfolioThumb: {
    width:           160,
    height:          160,
    borderRadius:    r.sm,
    backgroundColor: palette.skeleton,
    borderWidth:     2,
    borderColor:     '#FFFFFF',
  },

  // Reviews — overall
  overall: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  overallLeft: { alignItems: 'center', gap: 3, minWidth: 84 },
  overallScore: { fontFamily: fontFamily.extraBold, fontSize: 34, color: palette.textPrimary },
  overallCount: { fontFamily: fontFamily.regular, fontSize: 12, color: palette.textSecondary },
  starsRow: { flexDirection: 'row', gap: 2 },

  dist: { flex: 1, gap: 4 },
  distRow:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  distStar:  { fontFamily: fontFamily.regular, fontSize: 11, color: palette.textSecondary, width: 8 },
  distTrack: { flex: 1, height: 6, borderRadius: r.full, backgroundColor: palette.skeleton, overflow: 'hidden' },
  distFill:  { height: '100%', borderRadius: r.full, backgroundColor: palette.warning },
  distCount: { fontFamily: fontFamily.regular, fontSize: 11, color: palette.textSecondary, width: 18, textAlign: 'right' },

  // Review cards
  reviewCard: {
    borderWidth:     HAIRLINE,
    borderColor:     palette.border,
    borderRadius:    r.sm,
    backgroundColor: palette.surface,
    padding:         spacing.md,
    marginBottom:    spacing.sm,
  },
  reviewHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  reviewerRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  reviewerAvatar: {
    width: 28, height: 28, borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  reviewerInitials: { fontFamily: fontFamily.semiBold, fontSize: 11, color: palette.primary },
  reviewerName:  { fontFamily: fontFamily.medium, fontSize: 13, color: palette.textPrimary },
  reviewDate:    { fontFamily: fontFamily.regular, fontSize: 12, color: palette.textDisabled },
  reviewComment: { fontFamily: fontFamily.regular, fontSize: 13, color: palette.textSecondary, lineHeight: 19, marginTop: spacing.xs },

  seeAll:    { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minHeight: 44, justifyContent: 'center' },
  seeAllTxt: { fontFamily: fontFamily.semiBold, fontSize: 14, color: palette.primary },

  // Empty
  empty:    { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyTxt: { fontFamily: fontFamily.regular, fontSize: 14, color: palette.textSecondary },
});
