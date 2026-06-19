import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { storageUrl } from '../../api/client';
import { ApiError } from '../../api/errors';
import {
  ProviderReview,
  ProviderReviewsSummary,
  providersApi,
  ReviewSort,
} from '../../api/providers';
import { SkeletonBlock } from '../../components/ui/SkeletonBlock';
import { palette, radius as r, spacing, typography } from '../../theme';
import { fontFamily } from '../../theme/typography';

// ── Theme (dark/light, AA) — mirrors the redesigned provider screens ───────────
const HAIRLINE = StyleSheet.hairlineWidth;
type ThemeC = { bg: string; surface: string; border: string; t1: string; t2: string; t3: string; track: string };
const DARK:  ThemeC = { bg: '#0F0A0D', surface: '#1C1015', border: '#3A2030', t1: '#F5E8EE', t2: '#C79BB0', t3: '#7C5868', track: '#2A1620' };
const LIGHT: ThemeC = { bg: palette.background, surface: palette.surface, border: palette.border, t1: palette.textPrimary, t2: palette.textSecondary, t3: palette.textDisabled, track: palette.skeleton };

const SORTS: { key: ReviewSort; label: string }[] = [
  { key: 'recent',  label: 'Most recent' },
  { key: 'highest', label: 'Highest' },
  { key: 'lowest',  label: 'Lowest' },
];

const PER_PAGE = 15;

// ── Helpers ────────────────────────────────────────────────────────────────────
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
}

function resolveImg(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('http') ? path : storageUrl(path);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Stars (rating conveyed as text for screen readers) ─────────────────────────
function Stars({ rating, size = 13 }: { rating: number; size?: number }) {
  const full = Math.round(rating);
  return (
    <View style={styles.starsRow} accessibilityLabel={`${full} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Ionicons
          key={i}
          name={i < full ? 'star' : 'star-outline'}
          size={size}
          color={i < full ? palette.warning : palette.textDisabled}
        />
      ))}
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────────
export default function AllReviewsScreen({ route, navigation }: any) {
  const { providerId, providerName, avatarUrl, trustTier } = route.params as {
    providerId:   string;
    providerName?: string;
    avatarUrl?:   string | null;
    trustTier?:   number;
  };
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? DARK : LIGHT;

  const displayName = providerName ?? 'Provider';
  const avatar      = resolveImg(avatarUrl);
  const isVerified  = (trustTier ?? 0) >= 2;

  const [summary,     setSummary]     = useState<ProviderReviewsSummary | null>(null);
  const [reviews,     setReviews]     = useState<ProviderReview[]>([]);
  const [sort,        setSort]        = useState<ReviewSort>('recent');
  const [ratingFilter, setRatingFilter] = useState<number | null>(null);
  const [page,        setPage]        = useState(1);
  const [lastPage,    setLastPage]    = useState(1);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offline,     setOffline]     = useState(false);

  const fetchPage = useCallback(async (targetPage: number) => {
    try {
      const res = await providersApi.getReviews(providerId, {
        sort,
        rating: ratingFilter ?? undefined,
        page:   targetPage,
      });
      setSummary(res.summary);
      setPage(res.current_page);
      setLastPage(res.last_page);
      setReviews((prev) => (targetPage === 1 ? res.data : [...prev, ...res.data]));
      setOffline(false);
    } catch (e) {
      const apiErr = e instanceof ApiError ? e : null;
      const isNetwork = apiErr?.message?.toLowerCase().includes('network');
      // Keep whatever is on screen behind an offline notice; never blank out.
      if (isNetwork) setOffline(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [providerId, sort, ratingFilter]);

  // Sort / star-filter run server-side — reset to page 1 on any change.
  useEffect(() => {
    setLoading(true);
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, sort, ratingFilter]);

  const onEndReached = useCallback(() => {
    if (loading || loadingMore || page >= lastPage) return;
    setLoadingMore(true);
    fetchPage(page + 1);
  }, [loading, loadingMore, page, lastPage, fetchPage]);

  const selectSort = (key: ReviewSort) => {
    if (key === sort) return;
    Haptics.selectionAsync();
    setSort(key);
  };
  const toggleRating = (star: number) => {
    Haptics.selectionAsync();
    setRatingFilter((cur) => (cur === star ? null : star));
  };

  const total = summary?.count ?? 0;
  const distTotal = summary ? Object.values(summary.distribution).reduce((a, b) => a + b, 0) : 0;

  // ── Persistent header (identity + rating + distribution + controls) ──────────
  const Header = (
    <View style={[styles.headerWrap, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
      {/* Nav row */}
      <View style={styles.navRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={c.t1} />
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: c.t1 }]}>Reviews</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Mini identity */}
      <View style={styles.identityRow}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.idAvatar} contentFit="cover" transition={120} />
        ) : (
          <View style={[styles.idAvatar, styles.idAvatarFallback]}>
            <Text style={styles.idInitials}>{initialsOf(displayName)}</Text>
          </View>
        )}
        <Text style={[styles.idName, { color: c.t1 }]} numberOfLines={1}>{displayName}</Text>
        {isVerified && (
          <Ionicons name="checkmark-circle" size={16} color={palette.success} accessibilityLabel="Verified provider" />
        )}
      </View>

      {/* Overall rating + distribution */}
      <View style={styles.overall}>
        <View style={styles.overallLeft}>
          <Text style={[styles.overallScore, { color: c.t1 }]}>
            {summary?.rating != null ? summary.rating.toFixed(1) : '–'}
          </Text>
          <Stars rating={summary?.rating ?? 0} />
          <Text style={[styles.overallCount, { color: c.t2 }]}>
            {total} {total === 1 ? 'review' : 'reviews'}
          </Text>
        </View>
        <View style={styles.dist} accessibilityLabel="Rating distribution">
          {(['5', '4', '3', '2', '1'] as const).map((star) => {
            const count = summary?.distribution[star] ?? 0;
            return (
              <View key={star} style={styles.distRow} accessibilityLabel={`${star} star: ${count}`}>
                <Text style={[styles.distStar, { color: c.t2 }]}>{star}</Text>
                <Ionicons name="star" size={10} color={c.t3} />
                <View style={[styles.distTrack, { backgroundColor: c.track }]}>
                  <View style={[styles.distFill, { width: `${distTotal ? (count / distTotal) * 100 : 0}%` }]} />
                </View>
                <Text style={[styles.distCount, { color: c.t2 }]}>{count}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Sort control */}
      <View style={styles.controls}>
        <View style={[styles.segment, { borderColor: c.border }]} accessibilityRole="radiogroup">
          {SORTS.map((s) => {
            const active = s.key === sort;
            return (
              <TouchableRipple
                key={s.key}
                onPress={() => selectSort(s.key)}
                borderless
                style={styles.segTap}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Sort by ${s.label}`}
              >
                <View style={[styles.segBtn, active && { backgroundColor: palette.primary }]}>
                  <Text style={[styles.segTxt, { color: active ? '#FFFFFF' : c.t2 }]}>{s.label}</Text>
                </View>
              </TouchableRipple>
            );
          })}
        </View>

        {/* Optional star-rating filter */}
        <View style={styles.filterRow}>
          {[5, 4, 3, 2, 1].map((star) => {
            const active = ratingFilter === star;
            return (
              <TouchableOpacity
                key={star}
                onPress={() => toggleRating(star)}
                style={[
                  styles.filterChip,
                  { borderColor: c.border, backgroundColor: c.surface },
                  active && { borderColor: palette.primary, backgroundColor: palette.primaryLight },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${active ? 'Remove' : 'Filter by'} ${star} star reviews`}
              >
                <Text style={[styles.filterTxt, { color: active ? palette.primary : c.t2 }]}>{star}</Text>
                <Ionicons name="star" size={10} color={active ? palette.primary : c.t3} />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top']}>
      {offline && (
        <View style={styles.offlineBar}>
          <Ionicons name="cloud-offline-outline" size={14} color={palette.warning} />
          <Text style={styles.offlineTxt}>Offline — showing saved reviews</Text>
        </View>
      )}

      {Header}

      {loading ? (
        <View style={styles.body}>
          {[1, 2, 3, 4].map((k) => (
            <View key={k} style={styles.skeletonItem}>
              <SkeletonBlock width="45%" height={14} />
              <SkeletonBlock width="30%" height={12} style={{ marginTop: spacing.sm }} />
              <SkeletonBlock width="100%" height={12} style={{ marginTop: spacing.sm }} />
              <SkeletonBlock width="80%" height={12} style={{ marginTop: spacing.xs }} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList<ProviderReview>
          data={reviews}
          keyExtractor={(item) => item.id}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={reviews.length === 0 ? styles.emptyContent : { paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={[styles.itemDivider, { backgroundColor: c.border }]} />}
          renderItem={({ item }) => <ReviewRow review={item} c={c} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubble-ellipses-outline" size={36} color={c.t3} />
              <Text style={[styles.emptyTxt, { color: c.t2 }]}>
                {ratingFilter ? `No ${ratingFilter}-star reviews` : 'No reviews yet'}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color={palette.primary} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

// ── Review row (flat, divider-separated) ───────────────────────────────────────
function ReviewRow({ review, c }: { review: ProviderReview; c: ThemeC }) {
  return (
    <View style={styles.item}>
      <View style={styles.itemHeader}>
        <View style={styles.reviewerRow}>
          <View style={styles.reviewerAvatar}>
            <Text style={styles.reviewerInitials}>{initialsOf(review.reviewer.name)}</Text>
          </View>
          <Text style={[styles.reviewerName, { color: c.t1 }]} numberOfLines={1}>{review.reviewer.name}</Text>
        </View>
        <Text style={[styles.reviewDate, { color: c.t3 }]}>{fmtDate(review.created_at)}</Text>
      </View>

      <View style={styles.starsLine}>
        <Stars rating={review.rating} />
      </View>

      {!!review.comment && (
        <Text style={[styles.comment, { color: c.t2 }]}>{review.comment}</Text>
      )}

      {/* The service this review was left for — small, secondary */}
      {!!review.service && (
        <View style={styles.metaRow}>
          <Ionicons name="briefcase-outline" size={12} color={c.t3} />
          <Text style={[styles.metaTxt, { color: c.t3 }]} numberOfLines={1}>{review.service.title}</Text>
        </View>
      )}

      {/* Verified-booking marker — anti-fake trust signal (§10.4) */}
      {review.verified && (
        <View style={styles.verifiedRow} accessibilityLabel="Verified booking">
          <Ionicons name="shield-checkmark" size={12} color={palette.success} />
          <Text style={styles.verifiedTxt}>Verified booking</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const ID_AVATAR = 32;

const styles = StyleSheet.create({
  safe: { flex: 1 },

  offlineBar: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             spacing.xs,
    backgroundColor: palette.warningLight,
    paddingVertical: spacing.xs,
  },
  offlineTxt: { fontFamily: fontFamily.regular, fontSize: 12, color: palette.warning },

  // Persistent header
  headerWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom:     spacing.md,
    borderBottomWidth: HAIRLINE,
  },
  navRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  navTitle: { ...typography.heading3, fontSize: 18 },

  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  idAvatar:    { width: ID_AVATAR, height: ID_AVATAR, borderRadius: r.full },
  idAvatarFallback: { backgroundColor: palette.primaryLight, alignItems: 'center', justifyContent: 'center' },
  idInitials:  { fontFamily: fontFamily.semiBold, fontSize: 12, color: palette.primary },
  idName:      { fontFamily: fontFamily.semiBold, fontSize: 15, flexShrink: 1 },

  // Overall + distribution
  overall:     { flexDirection: 'row', gap: spacing.lg, alignItems: 'center', marginTop: spacing.md },
  overallLeft: { alignItems: 'center', gap: 3, minWidth: 84 },
  overallScore: { fontFamily: fontFamily.extraBold, fontSize: 34 },
  overallCount: { fontFamily: fontFamily.regular, fontSize: 12 },
  starsRow:     { flexDirection: 'row', gap: 2 },

  dist:      { flex: 1, gap: 4 },
  distRow:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  distStar:  { fontFamily: fontFamily.regular, fontSize: 11, width: 8 },
  distTrack: { flex: 1, height: 6, borderRadius: r.full, overflow: 'hidden' },
  distFill:  { height: '100%', borderRadius: r.full, backgroundColor: palette.warning },
  distCount: { fontFamily: fontFamily.regular, fontSize: 11, width: 18, textAlign: 'right' },

  // Controls
  controls: { marginTop: spacing.md, gap: spacing.sm },
  segment: {
    flexDirection: 'row',
    borderWidth:   HAIRLINE,
    borderRadius:  r.sm,
    overflow:      'hidden',
  },
  segTap: { flex: 1 },
  segBtn: { minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  segTxt: { fontFamily: fontFamily.medium, fontSize: 13 },

  filterRow:  { flexDirection: 'row', gap: spacing.xs },
  filterChip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    borderWidth:       HAIRLINE,
    borderRadius:      r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical:   5,
    minHeight:         32,
  },
  filterTxt: { fontFamily: fontFamily.medium, fontSize: 12 },

  // List body
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  skeletonItem: { paddingVertical: spacing.md },

  itemDivider: { height: HAIRLINE, marginHorizontal: spacing.lg },

  item: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  reviewerAvatar: {
    width: 28, height: 28, borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  reviewerInitials: { fontFamily: fontFamily.semiBold, fontSize: 11, color: palette.primary },
  reviewerName: { fontFamily: fontFamily.medium, fontSize: 13, flexShrink: 1 },
  reviewDate:   { fontFamily: fontFamily.regular, fontSize: 12 },

  starsLine: { marginTop: spacing.xs },
  comment:   { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 19, marginTop: spacing.xs },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  metaTxt: { fontFamily: fontFamily.regular, fontSize: 12, flexShrink: 1 },

  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  verifiedTxt: { fontFamily: fontFamily.medium, fontSize: 11, color: palette.success },

  // Empty / footer
  emptyContent: { flexGrow: 1 },
  empty:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyTxt: { fontFamily: fontFamily.regular, fontSize: 14 },
  footer:   { paddingVertical: spacing.lg, alignItems: 'center' },
});
