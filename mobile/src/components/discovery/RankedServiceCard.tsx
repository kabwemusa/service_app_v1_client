import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { storageUrl } from '../../api/client';
import { SearchResult } from '../../api/search';
import { PricingModel, Service } from '../../api/services';
import { palette, radius as r, spacing } from '../../theme';
import { fontFamily } from '../../theme/typography';
import { VettingBadge } from './VettingBadge';

// ── Normalised shape ─────────────────────────────────────────────────────────
// One canonical ranked card, used wherever ranked results appear (home / search /
// browse). Both the rich `Service` (detail/list) and the slim `SearchResult`
// (ranked search) map onto this interface via the helpers below so the card stays
// the single source of truth for ranked result styling.

export interface RankedCardData {
  id:            string;
  title:         string;
  pricing_model: PricingModel;
  base_price:    number | null;
  payment_mode:  'DIRECT' | 'ESCROW';
  /** Category tint + icon fallback when no photo is available. */
  category:      { id: number; name: string; icon: string | null } | null;
  /** First photo's relative path, or null → render the category tint + icon. */
  photoPath:     string | null;
  distance_km:   number | null;
  /** v3.2 §8.5 — 'promoted' rows occupy reserved positions and MUST be labelled. */
  placement:     'organic' | 'promoted';
  /** v3 §7.3 fairness floor — honest completed-job count for the "Rising star" label. */
  completed_job_count: number | null;
  /** Estimated duration (minutes) — carried into the booking summary. */
  duration_estimate_mins?: number | null;
  provider: {
    display_name:           string | null;
    avatar_url?:            string | null;
    /** Bayesian rating (§7.1) — preferred over r_raw; raw trust_score is NEVER shown. */
    r_bayes?:               number | null;
    r_raw:                  number;
    v_reviews:              number;
    trust_tier:             number;
    response_time_p50_mins: number | null;
    availability_matrix?:   Record<string, { start: string; end: string }[]> | null;
  } | null;
}

// Deterministic category tint — rotates by category.id so every category gets a colour.
const CAT_PALETTE = [
  '#0891B2', '#2563EB', '#7C3AED', '#D97706',
  '#DB2777', '#16A34A', '#4B5563', '#0369A1',
  '#15803D', '#B45309', '#1D4ED8', '#1E40AF',
  '#92400E', '#9D174D',
];

// Cold-start provider appearing via the fairness floor (v3 §7.3).
const RISING_STAR_JOB_THRESHOLD = 10;

// §5.1/§6.1/§6.2 — short price label for compact lists (kept for back-compat).
export function priceLabel(pricingModel: PricingModel, basePrice: number | null): string {
  if (pricingModel === 'QUOTE' || basePrice == null) return 'By quote';
  if (pricingModel === 'HOURLY') return `ZMW ${basePrice.toFixed(0)}/hr`;
  return `ZMW ${basePrice.toFixed(0)}`;
}

// §5 footer price — fixed / "from" (variable) / by quote.
export function footerPriceLabel(pricingModel: PricingModel, basePrice: number | null): string {
  if (pricingModel === 'QUOTE' || basePrice == null) return 'By quote';
  if (pricingModel === 'HOURLY') return `from ZMW ${basePrice.toFixed(0)}/hr`;
  return `ZMW ${basePrice.toFixed(0)}`;
}

function formatResponseTime(mins: number | null | undefined): string | null {
  if (mins == null) return null;
  if (mins < 60)    return `~${mins} min reply`;
  return `~${Math.ceil(mins / 60)}h reply`;
}

// ── Mappers ────────────────────────────────────────────────────────────────────

export function searchResultToCard(s: SearchResult): RankedCardData {
  return {
    id:            s.id,
    title:         s.title,
    pricing_model: s.pricing_model,
    base_price:    s.base_price,
    payment_mode:  s.payment_mode,
    category:      s.category ? { id: s.category.id, name: s.category.name, icon: s.category.icon } : null,
    photoPath:     null, // search results carry no photos → category tint fallback
    distance_km:   s.distance_km,
    placement:     s.placement,
    completed_job_count: s.completed_job_count,
    provider: s.provider
      ? {
          display_name:           s.provider.display_name,
          r_bayes:                s.provider.r_bayes,
          r_raw:                  s.provider.r_raw,
          v_reviews:              s.provider.v_reviews,
          trust_tier:             s.provider.trust_tier,
          response_time_p50_mins: s.provider.response_time_p50_mins,
        }
      : null,
  };
}

export function serviceToCard(s: Service): RankedCardData {
  return {
    id:            s.id,
    title:         s.title,
    pricing_model: s.pricing_model,
    base_price:    s.base_price,
    payment_mode:  s.payment_mode,
    category:      s.category ? { id: s.category.id, name: s.category.name, icon: null } : null,
    photoPath:     s.photos?.[0]?.path ?? null,
    distance_km:   s.distance_km,
    placement:     'organic',
    completed_job_count: s.bookings_count ?? null,
    duration_estimate_mins: s.duration_estimate_mins,
    provider: s.provider
      ? {
          display_name:           s.provider.display_name,
          avatar_url:             s.provider.avatar_url,
          r_raw:                  s.provider.r_raw,
          v_reviews:              s.provider.v_reviews,
          trust_tier:             s.provider.trust_tier,
          response_time_p50_mins: s.provider.response_time_p50_mins,
          availability_matrix:    s.provider.availability_matrix,
        }
      : null,
  };
}

// ── Component ────────────────────────────────────────────────────────────────────

interface Props {
  data:          RankedCardData;
  saved:         boolean;
  onPress:       () => void;
  onBook:        () => void;
  onToggleSave:  () => void;
}

export function RankedServiceCard({ data, saved, onPress, onBook, onToggleSave }: Props) {
  const provider = data.provider;
  const catColor = CAT_PALETTE[(data.category?.id ?? 0) % CAT_PALETTE.length];
  const catIcon  = (data.category?.icon ?? 'grid-outline') as React.ComponentProps<typeof Ionicons>['name'];

  const isPromoted   = data.placement === 'promoted';
  const isRisingStar = !isPromoted
    && data.completed_job_count != null
    && data.completed_job_count < RISING_STAR_JOB_THRESHOLD;
  const isVerified   = (provider?.trust_tier ?? 0) >= 2;
  const rating       = provider ? (provider.r_bayes ?? provider.r_raw) : null;
  const responseTime = formatResponseTime(provider?.response_time_p50_mins);
  const isQuote      = data.pricing_model === 'QUOTE' || data.base_price == null;

  const placementLabel = isPromoted ? 'Promoted' : isRisingStar ? 'Rising star' : null;

  return (
    <TouchableRipple
      onPress={onPress}
      borderless
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${data.title} by ${provider?.display_name ?? 'provider'}, ${footerPriceLabel(data.pricing_model, data.base_price)}`}
    >
      <View>
        {/* ── Top section: thumbnail + body ───────────────────────────── */}
        <View style={styles.top}>

          {/* Thumbnail — photo, else category tint + icon */}
          <View style={styles.thumbWrap}>
            {data.photoPath ? (
              <Image
                source={{ uri: storageUrl(data.photoPath) }}
                style={styles.thumb}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={150}
              />
            ) : (
              <View style={[styles.thumb, { backgroundColor: `${catColor}18` }]}>
                <Ionicons name={catIcon} size={26} color={catColor} />
              </View>
            )}

            {/* Ranking-state label — overlaid bottom-left, always honest, never disguised */}
            {placementLabel && (
              <View style={[styles.placement, isPromoted ? styles.placementPromoted : styles.placementRising]}>
                <Ionicons
                  name={isPromoted ? 'megaphone-outline' : 'trending-up-outline'}
                  size={10}
                  color={isPromoted ? palette.warning : palette.primary}
                />
                <Text style={[styles.placementTxt, { color: isPromoted ? palette.warning : palette.primary }]}>
                  {placementLabel}
                </Text>
              </View>
            )}

            {/* Save / heart — optimistic toggle, overlaid top-right */}
            <TouchableOpacity
              style={styles.heartBtn}
              onPress={onToggleSave}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Remove from saved' : 'Save service'}
              accessibilityState={{ selected: saved }}
            >
              <Ionicons
                name={saved ? 'heart' : 'heart-outline'}
                size={16}
                color={saved ? palette.secondary : '#fff'}
              />
            </TouchableOpacity>
          </View>

          {/* Body */}
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={2}>{data.title}</Text>

            {/* Provider line — avatar + name + verified check + tier marker */}
            {provider && (
              <View style={styles.providerLine}>
                {provider.avatar_url ? (
                  <Image source={{ uri: provider.avatar_url }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarInitial}>
                      {(provider.display_name || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={styles.providerName} numberOfLines={1}>{provider.display_name}</Text>
                {isVerified && <Ionicons name="checkmark-circle" size={13} color={palette.success} />}
                <VettingBadge trustTier={provider.trust_tier} size="sm" />
              </View>
            )}

            {/* Signal pills — rating leads (accent), distance, response speed */}
            <View style={styles.pills}>
              {provider && provider.v_reviews > 0 && rating != null && (
                <View style={[styles.pill, styles.pillRating]}>
                  <Ionicons name="star" size={11} color={palette.warning} />
                  <Text style={[styles.pillTxt, styles.pillRatingTxt]}>
                    {rating.toFixed(1)} ({provider.v_reviews})
                  </Text>
                </View>
              )}
              {data.distance_km != null && (
                <View style={styles.pill}>
                  <Ionicons name="location-outline" size={11} color={palette.textSecondary} />
                  <Text style={styles.pillTxt}>{data.distance_km} km</Text>
                </View>
              )}
              {responseTime && (
                <View style={styles.pill}>
                  <Ionicons name="flash-outline" size={11} color={palette.textSecondary} />
                  <Text style={styles.pillTxt}>{responseTime}</Text>
                </View>
              )}
              {isRisingStar && data.completed_job_count != null && (
                <View style={[styles.pill, styles.pillRising]}>
                  <Text style={[styles.pillTxt, styles.pillRisingTxt]}>
                    {data.completed_job_count} {data.completed_job_count === 1 ? 'job' : 'jobs'} so far
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── Divider ─────────────────────────────────────────────────── */}
        <View style={styles.divider} />

        {/* ── Footer: price + Book ────────────────────────────────────── */}
        <View style={styles.footer}>
          <View style={styles.priceWrap}>
            <Text style={styles.price}>{footerPriceLabel(data.pricing_model, data.base_price)}</Text>
          </View>
          <TouchableOpacity
            style={styles.bookBtn}
            onPress={onBook}
            accessibilityRole="button"
            accessibilityLabel={isQuote ? `Request a quote for ${data.title}` : `Book ${data.title}`}
          >
            <Text style={styles.bookTxt}>{isQuote ? 'Request quote' : 'Book'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableRipple>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const THUMB = 96;

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius:    r.sm,
    borderWidth:     1,
    borderColor:     palette.border,
    marginBottom:    spacing.sm,
    overflow:        'hidden',
  },

  top: { flexDirection: 'row', padding: spacing.sm },

  // Thumbnail
  thumbWrap: { width: THUMB, height: THUMB },
  thumb: {
    width:          THUMB,
    height:         THUMB,
    borderRadius:   r.sm,
    alignItems:     'center',
    justifyContent: 'center',
    overflow:       'hidden',
  },
  placement: {
    position:          'absolute',
    bottom:            5,
    left:              5,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    borderRadius:      r.full,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  placementPromoted: { backgroundColor: palette.warningLight },
  placementRising:   { backgroundColor: palette.primaryLight },
  placementTxt:      { fontFamily: fontFamily.semiBold, fontSize: 10 },

  heartBtn: {
    position:        'absolute',
    top:             4,
    right:           4,
    width:           28,
    height:          28,
    borderRadius:    r.full,
    backgroundColor: 'rgba(15,23,42,0.32)',
    alignItems:      'center',
    justifyContent:  'center',
  },

  // Body
  body: {
    flex:        1,
    marginLeft:  spacing.md,
    gap:         5,
  },
  title: {
    fontFamily: fontFamily.semiBold,
    fontSize:   15,
    color:      palette.textPrimary,
    lineHeight: 20,
  },

  // Provider line
  providerLine: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
    flexWrap:      'wrap',
  },
  avatar: {
    width:           22,
    height:          22,
    borderRadius:    r.full,
    backgroundColor: palette.primaryLight,
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',
  },
  avatarInitial: { fontFamily: fontFamily.semiBold, fontSize: 10, color: palette.primary },
  providerName:  { fontFamily: fontFamily.regular, fontSize: 12, color: palette.textSecondary, flexShrink: 1, maxWidth: 110 },

  // Signal pills
  pills: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  pill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    backgroundColor:   palette.background,
    borderRadius:      r.full,
    paddingHorizontal: 7,
    paddingVertical:   3,
    borderWidth:       1,
    borderColor:       palette.border,
  },
  pillTxt:        { fontFamily: fontFamily.regular, fontSize: 11, color: palette.textSecondary },
  pillRating:     { backgroundColor: palette.warningLight, borderColor: palette.warningLight },
  pillRatingTxt:  { fontFamily: fontFamily.semiBold, color: palette.warning },
  pillRising:     { backgroundColor: palette.primaryLight, borderColor: palette.primaryLight },
  pillRisingTxt:  { color: palette.primary },

  // Divider
  divider: { height: 1, backgroundColor: palette.border },

  // Footer
  footer: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
  },
  priceWrap: { flex: 1 },
  price:     { fontFamily: fontFamily.bold, fontSize: 15, color: palette.textPrimary },
  bookBtn: {
    backgroundColor:   palette.primary,
    borderRadius:      r.full,
    paddingHorizontal: spacing.lg,
    minHeight:         36,
    alignItems:        'center',
    justifyContent:    'center',
  },
  bookTxt: { fontFamily: fontFamily.semiBold, fontSize: 13, color: '#fff' },
});
