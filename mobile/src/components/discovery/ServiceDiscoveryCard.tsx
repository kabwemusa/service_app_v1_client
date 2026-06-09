import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SearchResult } from '../../api/search';
import { palette, radius as r, spacing } from '../../theme';
import { fontFamily } from '../../theme/typography';

// ── Helpers ──────────────────────────────────────────────────────────────────

function tierLabel(tier: number): string {
  if (tier >= 3) return 'Elite';
  if (tier === 2) return 'Trusted';
  return 'Verified';
}

function tierColor(tier: number): string {
  return tier >= 3 ? palette.warning : palette.success;
}

function formatDistance(km: number | null): string | null {
  if (km === null) return null;
  if (km < 1)      return '< 1 km';
  return `${km.toFixed(1)} km`;
}

function formatResponseTime(mins: number | null): string | null {
  if (mins === null || mins <= 0) return null;
  if (mins < 60)                  return `~${Math.round(mins)} min`;
  if (mins < 120)                 return '~1 hr';
  return `~${Math.round(mins / 60)} hr`;
}

function priceText(pricingModel: string, basePrice: number | null): string {
  if (pricingModel === 'QUOTE' || basePrice === null) return 'By quote';
  if (pricingModel === 'HOURLY') return `from ZMW ${basePrice.toFixed(0)}/hr`;
  return `from ZMW ${basePrice.toLocaleString()}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  result:  SearchResult;
  onPress: () => void;
  onBook:  () => void;
}

export function ServiceDiscoveryCard({ result, onPress, onBook }: Props) {
  const { provider, has_promo_slot, completed_job_count, distance_km } = result;

  const isRisingStar = provider.v_reviews === 0 && (completed_job_count ?? 0) === 0;
  const initial      = (provider.display_name || '?')[0].toUpperCase();
  const distText     = formatDistance(distance_km);
  const resText      = formatResponseTime(provider.response_time_p50_mins ?? null);
  const tColor       = tierColor(provider.trust_tier);
  const tLabel       = tierLabel(provider.trust_tier);
  const jobCount     = completed_job_count ?? 0;

  return (
    <TouchableRipple
      onPress={onPress}
      rippleColor="rgba(123,26,58,0.06)"
      style={styles.card}
      borderless={false}
    >
      <View>
        {/* ── Promoted banner ──────────────────────────────────────── */}
        {has_promo_slot && (
          <View style={styles.promotedBar}>
            <Ionicons name="flash" size={10} color={palette.warning} />
            <Text style={styles.promotedText}>Promoted</Text>
          </View>
        )}

        {/* ── Provider row ─────────────────────────────────────────── */}
        <View style={styles.providerRow}>
          {/* Avatar */}
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>

          {/* Info stack */}
          <View style={styles.providerInfo}>
            {/* Name + badges */}
            <View style={styles.nameRow}>
              <Text style={styles.providerName} numberOfLines={1}>
                {provider.display_name}
              </Text>
              {provider.trust_tier >= 2 && (
                <Ionicons
                  name="checkmark-circle"
                  size={14}
                  color={palette.success}
                  style={styles.verifiedIcon}
                />
              )}
              {isRisingStar ? (
                <View style={styles.risingStarChip}>
                  <Text style={styles.risingStarText}>Rising star</Text>
                </View>
              ) : (
                <View style={[styles.tierChip, { borderColor: tColor }]}>
                  <Text style={[styles.tierText, { color: tColor }]}>{tLabel}</Text>
                </View>
              )}
            </View>

            {/* Rating row */}
            {!isRisingStar && provider.v_reviews > 0 && (
              <View style={styles.metaRow}>
                <Ionicons name="star" size={11} color={palette.warning} />
                <Text style={styles.metaText}>
                  {provider.r_bayes.toFixed(1)} · {provider.v_reviews} review{provider.v_reviews !== 1 ? 's' : ''}
                </Text>
              </View>
            )}

            {/* Pills row */}
            {(resText || distText) ? (
              <View style={styles.metaRow}>
                {resText ? (
                  <>
                    <Ionicons name="flash-outline" size={11} color={palette.textSecondary} />
                    <Text style={styles.metaText}>{resText}</Text>
                  </>
                ) : null}
                {resText && distText ? (
                  <Text style={styles.dot}>·</Text>
                ) : null}
                {distText ? (
                  <>
                    <Ionicons name="location-outline" size={11} color={palette.textSecondary} />
                    <Text style={styles.metaText}>{distText}</Text>
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Divider ──────────────────────────────────────────────── */}
        <View style={styles.divider} />

        {/* ── Service row ──────────────────────────────────────────── */}
        <View style={styles.serviceRow}>
          <View style={styles.serviceLeft}>
            <Text style={styles.serviceTitle} numberOfLines={1}>
              {result.title}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.price}>{priceText(result.pricing_model, result.base_price)}</Text>
              {jobCount > 0 ? (
                <>
                  <Text style={styles.dot}>·</Text>
                  <Text style={styles.metaText}>
                    {jobCount >= 100 ? '100+' : jobCount} job{jobCount !== 1 ? 's' : ''}
                  </Text>
                </>
              ) : null}
            </View>
          </View>

          {/* Book / Get quote button */}
          <TouchableOpacity
            onPress={onBook}
            style={styles.bookBtn}
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            activeOpacity={0.75}
          >
            <Text style={styles.bookBtnText}>
              {result.pricing_model === 'QUOTE' ? 'Quote' : 'Book'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableRipple>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius:    r.lg,
    borderWidth:     1,
    borderColor:     palette.border,
    marginBottom:    spacing.sm,
    overflow:        'hidden',
  },

  // Promoted banner
  promotedBar: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    paddingHorizontal: spacing.md,
    paddingVertical:   5,
    backgroundColor:   palette.warningLight,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  promotedText: {
    fontFamily: fontFamily.medium,
    fontSize:   11,
    color:      palette.warning,
  },

  // Provider row
  providerRow: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    gap:            spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop:        spacing.sm + 4,
    paddingBottom:     spacing.sm,
  },
  avatar: {
    width:           40,
    height:          40,
    borderRadius:    r.full,
    backgroundColor: palette.primaryLight,
    borderWidth:     1,
    borderColor:     palette.border,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  avatarText: {
    fontFamily: fontFamily.medium,
    fontSize:   16,
    color:      palette.primary,
  },
  providerInfo: { flex: 1, gap: 2 },

  // Name + badges
  nameRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
    flexWrap:      'wrap',
  },
  providerName: {
    fontFamily: fontFamily.medium,
    fontSize:   14,
    color:      palette.textPrimary,
    flexShrink: 1,
  },
  verifiedIcon: { marginLeft: -2 },

  tierChip: {
    borderWidth:       1,
    borderRadius:      r.sm,
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  tierText: {
    fontFamily: fontFamily.medium,
    fontSize:   10,
  },
  risingStarChip: {
    backgroundColor:   palette.warningLight,
    borderRadius:      r.sm,
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  risingStarText: {
    fontFamily: fontFamily.medium,
    fontSize:   10,
    color:      palette.warning,
  },

  // Meta rows (rating, pills)
  metaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           3,
  },
  metaText: {
    fontFamily: fontFamily.regular,
    fontSize:   12,
    color:      palette.textSecondary,
  },
  dot: {
    fontFamily: fontFamily.regular,
    fontSize:   12,
    color:      palette.textDisabled,
    marginHorizontal: 1,
  },

  // Divider
  divider: {
    height:           1,
    backgroundColor:  palette.border,
    marginHorizontal: spacing.md,
  },

  // Service row
  serviceRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm + 2,
    gap:               spacing.sm,
  },
  serviceLeft: { flex: 1, gap: 2 },
  serviceTitle: {
    fontFamily: fontFamily.medium,
    fontSize:   13,
    color:      palette.textPrimary,
  },
  price: {
    fontFamily: fontFamily.medium,
    fontSize:   12,
    color:      palette.primary,
  },

  // Book button
  bookBtn: {
    backgroundColor:   palette.primary,
    borderRadius:      r.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical:   spacing.xs + 2,
    minHeight:         32,
    justifyContent:    'center',
  },
  bookBtnText: {
    fontFamily: fontFamily.medium,
    fontSize:   12,
    color:      '#fff',
  },
});
