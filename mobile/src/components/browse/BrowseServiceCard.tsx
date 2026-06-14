import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SearchResult } from '../../api/search';
import { priceLabel } from '../discovery/RankedServiceCard';
import { VettingBadge } from '../discovery/VettingBadge';
import { palette, radius as r, spacing } from '../../theme';
import { fontFamily } from '../../theme/typography';

// Deterministic palette — rotates by category.id so new categories always get a colour
const CAT_PALETTE = [
  '#0891B2', '#2563EB', '#7C3AED', '#D97706',
  '#DB2777', '#16A34A', '#4B5563', '#0369A1',
  '#15803D', '#B45309', '#1D4ED8', '#1E40AF',
  '#92400E', '#9D174D',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatResponseTime(mins: number | null): string | null {
  if (mins == null) return null;
  if (mins < 60)    return `<${mins} min`;
  return `<${Math.ceil(mins / 60)}h`;
}

// Rising-star threshold — cold-start provider appearing via the fairness floor (v3 §7.3)
const RISING_STAR_JOB_THRESHOLD = 10;

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  data:    SearchResult;
  saved:   boolean;
  onPress: () => void;
  onSave:  () => void;
}

export function BrowseServiceCard({ data, saved, onPress, onSave }: Props) {
  const { provider } = data;
  const catColor = CAT_PALETTE[(data.category?.id ?? 0) % CAT_PALETTE.length];
  const catIcon  = (data.category?.icon ?? 'grid-outline') as React.ComponentProps<typeof Ionicons>['name'];

  const responseTime = provider ? formatResponseTime(provider.response_time_p50_mins) : null;
  // v3.2 §1.5 — "Promoted" is structural: it marks a row occupying a reserved
  // promoted position, never a provider who merely owns a slot.
  const isPromoted   = data.placement === 'promoted';
  const isRisingStar = !isPromoted && data.completed_job_count < RISING_STAR_JOB_THRESHOLD;
  const isVerified   = (provider?.trust_tier ?? 0) >= 2;

  const placementLabel = isPromoted ? 'Promoted' : isRisingStar ? 'Rising star' : null;
  const placementStyle = isPromoted ? styles.placementPromoted : styles.placementRising;
  const placementTxt   = isPromoted
    ? styles.placementPromotedTxt
    : styles.placementRisingTxt;

  return (
    <TouchableRipple
      onPress={onPress}
      borderless
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${data.title} by ${provider?.display_name ?? 'provider'}, ${priceLabel(data.pricing_model, data.base_price)}`}
    >
      <View style={styles.inner}>

        {/* ── Thumbnail ─────────────────────────────────────────────── */}
        <View style={styles.thumbWrap}>
          <View style={[styles.thumb, { backgroundColor: `${catColor}18` }]}>
            <Ionicons name={catIcon} size={26} color={catColor} />
          </View>

          {/* Placement badge — overlaid bottom-left of thumbnail */}
          {placementLabel && (
            <View style={[styles.placementBadge, placementStyle]}>
              <Text style={[styles.placementTxt, placementTxt]}>{placementLabel}</Text>
            </View>
          )}
        </View>

        {/* ── Body ──────────────────────────────────────────────────── */}
        <View style={styles.body}>

          {/* Row 1: title + save heart */}
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>{data.title}</Text>
            <TouchableOpacity
              style={styles.heartBtn}
              onPress={onSave}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={saved ? 'Remove from saved' : 'Save service'}
              accessibilityRole="button"
            >
              <Ionicons
                name={saved ? 'heart' : 'heart-outline'}
                size={18}
                color={saved ? palette.secondary : palette.textDisabled}
              />
            </TouchableOpacity>
          </View>

          {/* Row 2: price */}
          <Text style={styles.price}>{priceLabel(data.pricing_model, data.base_price)}</Text>

          {/* Row 3: provider trust line — avatar + name + verified + tier */}
          {provider && (
            <View style={styles.trustLine}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>
                  {(provider.display_name || '?')[0].toUpperCase()}
                </Text>
              </View>
              <Text style={styles.providerName} numberOfLines={1}>{provider.display_name}</Text>
              {isVerified && (
                <Ionicons name="checkmark-circle" size={13} color={palette.success} />
              )}
              <VettingBadge trustTier={provider.trust_tier} size="sm" />
            </View>
          )}

          {/* Row 4: metric pills */}
          <View style={styles.pillsRow}>
            {/* Rating (Bayesian — amber accent, v3 §7.1) */}
            {provider && provider.v_reviews > 0 && (
              <View style={styles.pill}>
                <Ionicons name="star" size={11} color={palette.warning} />
                <Text style={styles.pillTxt}>
                  {(provider.r_bayes ?? provider.r_raw).toFixed(1)}
                </Text>
              </View>
            )}

            {/* Distance to active delivery location */}
            {data.distance_km != null && (
              <View style={styles.pill}>
                <Ionicons name="location-outline" size={11} color={palette.textSecondary} />
                <Text style={styles.pillTxt}>{data.distance_km} km</Text>
              </View>
            )}

            {/* Response speed */}
            {responseTime && (
              <View style={styles.pill}>
                <Ionicons name="flash-outline" size={11} color={palette.textSecondary} />
                <Text style={styles.pillTxt}>{responseTime}</Text>
              </View>
            )}

            {/* Rising star honest job count */}
            {isRisingStar && (
              <View style={[styles.pill, styles.pillRising]}>
                <Ionicons name="trending-up-outline" size={11} color={palette.primary} />
                <Text style={[styles.pillTxt, styles.pillRisingTxt]}>
                  {data.completed_job_count} jobs
                </Text>
              </View>
            )}
          </View>

        </View>
      </View>
    </TouchableRipple>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const THUMB_W = 88;

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius:    r.lg,
    borderWidth:     1,
    borderColor:     palette.border,
    marginBottom:    spacing.sm,
    overflow:        'hidden',
  },
  inner: { flexDirection: 'row' },

  // Thumbnail
  thumbWrap: {
    width:    THUMB_W,
    alignSelf: 'stretch',
  },
  thumb: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    minHeight:      104,
  },

  // Placement badge
  placementBadge: {
    position:          'absolute',
    bottom:            6,
    left:              6,
    borderRadius:      r.full,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  placementPromoted:    { backgroundColor: palette.warningLight },
  placementRising:      { backgroundColor: palette.primaryLight },
  placementTxt: {
    fontFamily: fontFamily.medium,
    fontSize:   10,
  },
  placementPromotedTxt: { color: palette.warning },
  placementRisingTxt:   { color: palette.primary },

  // Body
  body: {
    flex:            1,
    padding:         spacing.sm,
    paddingLeft:     spacing.md,
    justifyContent:  'space-between',
    gap:             4,
  },

  titleRow: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            spacing.xs,
  },
  title: {
    fontFamily: fontFamily.medium,
    fontSize:   15,
    color:      palette.textPrimary,
    flex:       1,
    lineHeight: 20,
  },
  heartBtn: {
    width:          44,
    height:         44,
    alignItems:     'center',
    justifyContent: 'center',
    marginTop:      -8,
    marginRight:    -8,
  },

  price: {
    fontFamily: fontFamily.medium,
    fontSize:   13,
    color:      palette.primary,
  },

  // Provider trust line
  trustLine: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
    flexWrap:      'wrap',
  },
  avatarCircle: {
    width:           22,
    height:          22,
    borderRadius:    r.full,
    backgroundColor: palette.primaryLight,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  avatarInitial: {
    fontFamily: fontFamily.medium,
    fontSize:   10,
    color:      palette.primary,
  },
  providerName: {
    fontFamily: fontFamily.regular,
    fontSize:   12,
    color:      palette.textSecondary,
    flexShrink: 1,
    maxWidth:   90,
  },

  // Pills row
  pillsRow: {
    flexDirection:  'row',
    alignItems:     'center',
    flexWrap:       'wrap',
    gap:            6,
  },
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
  pillTxt: {
    fontFamily: fontFamily.regular,
    fontSize:   11,
    color:      palette.textSecondary,
  },
  pillRising: {
    backgroundColor: palette.primaryLight,
    borderColor:     palette.border,
  },
  pillRisingTxt: {
    color: palette.primary,
  },
});
