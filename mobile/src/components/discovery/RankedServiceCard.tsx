import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { storageUrl } from '../../api/client';
import { PricingModel } from '../../api/services';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';
import { VettingBadge } from './VettingBadge';

// ── Normalised shape ─────────────────────────────────────────────────────────
// Both Service and SearchResult can be mapped to this interface so the card
// works in discovery, search results, and home screens alike.

export interface RankedCardData {
  id:            string;
  title:         string;
  pricing_model: PricingModel;
  base_price:    number | null;
  category:      { name: string } | null;
  distance_km:   number | null;
  photos:        { path: string }[];
  provider: {
    r_raw:           number;
    v_reviews:       number;
    completion_rate: number;
    trust_tier?:     number;
  } | null;
}

// §5.1/§6.1/§6.2 — pricing_model-aware price label for cards & lists.
export function priceLabel(pricingModel: PricingModel, basePrice: number | null): string {
  if (pricingModel === 'QUOTE' || basePrice == null) return 'By quote';
  if (pricingModel === 'HOURLY') return `ZMW ${basePrice.toFixed(0)}/hr`;
  return `ZMW ${basePrice.toFixed(0)}`;
}

interface Props {
  data:    RankedCardData;
  onPress: () => void;
  onBook:  () => void;
}

export function RankedServiceCard({ data, onPress, onBook }: Props) {
  const photo    = data.photos?.[0];
  const provider = data.provider;

  return (
    <TouchableRipple onPress={onPress} borderless style={styles.card}>
      <View style={styles.inner}>

        {/* ── Photo thumbnail ───────────────────────────────── */}
        {photo ? (
          <Image
            source={{ uri: storageUrl(photo.path) }}
            style={styles.thumb}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Ionicons name="image-outline" size={22} color={palette.textDisabled} />
          </View>
        )}

        {/* ── Body ─────────────────────────────────────────── */}
        <View style={styles.body}>

          {/* Title + Price */}
          <View style={styles.topRow}>
            <Text style={styles.title} numberOfLines={1}>{data.title}</Text>
            <Text style={styles.price}>{priceLabel(data.pricing_model, data.base_price)}</Text>
          </View>

          {/* Rating + vetting badge */}
          {provider && (
            <View style={styles.metaRow}>
              <Ionicons name="star" size={12} color={palette.warning} />
              <Text style={styles.metaTxt}>
                {provider.r_raw.toFixed(1)} ({provider.v_reviews})
              </Text>
              {provider.trust_tier !== undefined && (
                <VettingBadge trustTier={provider.trust_tier} size="sm" />
              )}
            </View>
          )}

          {/* Distance + quick Book pill */}
          <View style={styles.footRow}>
            {data.distance_km != null ? (
              <View style={styles.distRow}>
                <Ionicons name="location-outline" size={11} color={palette.textSecondary} />
                <Text style={styles.distTxt}>{data.distance_km} km</Text>
              </View>
            ) : (
              <View />
            )}

            <TouchableOpacity
              style={styles.bookPill}
              onPress={onBook}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.bookPillTxt}>{data.pricing_model === 'QUOTE' ? 'Request quote' : 'Book'}</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius:    r.lg,
    borderWidth:     1,
    borderColor:     palette.border,
    marginBottom:    spacing.sm,
    overflow:        'hidden',
    ...shadow.card,
  },
  inner: { flexDirection: 'row' },

  thumb: { width: 90, height: 92 },
  thumbEmpty: {
    backgroundColor: palette.primaryLight,
    alignItems:      'center',
    justifyContent:  'center',
  },

  body: {
    flex: 1,
    padding:       spacing.sm,
    paddingLeft:   spacing.md,
    justifyContent: 'space-between',
  },

  topRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
    gap: spacing.xs,
  },
  title: {
    ...typography.label,
    color:    palette.textPrimary,
    fontSize: 15,
    flex: 1,
  },
  price: {
    ...typography.label,
    color:    palette.primary,
    fontSize: 14,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
    marginTop:     3,
    flexWrap:      'wrap',
  },
  metaTxt: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },

  footRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginTop:      5,
  },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  distTxt: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },

  bookPill: {
    backgroundColor:   palette.primary,
    borderRadius:      r.full,
    paddingHorizontal: spacing.md,
    paddingVertical:   4,
  },
  bookPillTxt: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color:      '#fff',
    fontSize:   12,
  },
});
