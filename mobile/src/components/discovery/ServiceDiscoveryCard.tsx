import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useCallback, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { storageUrl } from '../../api/client';
import { SearchResult } from '../../api/search';
import { isQuoteFirstModel } from './RankedServiceCard';
import { palette, radius as r, spacing } from '../../theme';
import { fontFamily } from '../../theme/typography';

const PHOTO_H = 180;
const HAIRLINE = StyleSheet.hairlineWidth;

function tierLabel(tier: number): string {
  if (tier >= 3) return 'Elite';
  if (tier === 2) return 'Trusted';
  return 'Verified';
}

function tierColor(tier: number): string {
  return tier >= 3 ? palette.warning : palette.success;
}

function priceText(model: string, price: number | null): string {
  if (model === 'QUOTE' || price === null) return 'By quote';
  if (model === 'HOURLY') return `ZMW ${price.toFixed(0)}/hr`;
  return `ZMW ${price.toLocaleString()}`;
}

interface Props {
  result:  SearchResult;
  onPress: () => void;
  onBook:  () => void;
}

export const ServiceDiscoveryCard = React.memo(function ServiceDiscoveryCard({ result, onPress, onBook }: Props) {
  const { provider, has_promo_slot, completed_job_count, photo_urls } = result;
  const photos = photo_urls ?? [];
  const [photoIdx, setPhotoIdx] = useState(0);
  const [cardW, setCardW] = useState(0);

  const isRisingStar = provider.v_reviews === 0 && (completed_job_count ?? 0) === 0;
  const initial      = (provider.display_name || '?')[0].toUpperCase();
  const tColor       = tierColor(provider.trust_tier);
  const tLabel       = tierLabel(provider.trust_tier);
  const jobCount     = completed_job_count ?? 0;
  const location     = provider.base_location_label;

  const onLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    setCardW(e.nativeEvent.layout.width);
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (cardW > 0) {
      setPhotoIdx(Math.round(e.nativeEvent.contentOffset.x / cardW));
    }
  }, [cardW]);

  return (
    <TouchableRipple
      onPress={onPress}
      rippleColor="rgba(123,26,58,0.06)"
      style={st.card}
      borderless={false}
    >
      <View onLayout={onLayout}>
        {/* ── Promoted banner ──────────────────────────────────────── */}
        {has_promo_slot && (
          <View style={st.promotedBar}>
            <Ionicons name="flash" size={10} color={palette.warning} />
            <Text style={st.promotedText}>Promoted</Text>
          </View>
        )}

        {/* ── 1. Photo carousel / fallback ─────────────────────────── */}
        {photos.length > 0 && cardW > 0 ? (
          <View style={st.photoWrap}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              decelerationRate="fast"
              nestedScrollEnabled
            >
              {photos.map((path, i) => (
                <Image
                  key={`${path}-${i}`}
                  source={{ uri: storageUrl(path) }}
                  style={[st.photo, { width: cardW }]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={path}
                  transition={100}
                />
              ))}
            </ScrollView>
            {photos.length > 1 && (
              <View style={st.dotRow}>
                {photos.slice(0, 5).map((_, i) => (
                  <View key={i} style={[st.dot, i === photoIdx && st.dotActive]} />
                ))}
                {photos.length > 5 && <Text style={st.dotMore}>+{photos.length - 5}</Text>}
              </View>
            )}
          </View>
        ) : photos.length > 0 && cardW === 0 ? (
          <View style={[st.photoFallback, { backgroundColor: palette.skeleton }]} />
        ) : (
          <View style={st.photoFallback}>
            <View style={st.fallbackIcon}>
              <Ionicons
                name={(result.category.icon ?? 'grid-outline') as any}
                size={28}
                color={palette.primary}
              />
            </View>
            <Text style={st.fallbackText}>{result.category.name}</Text>
          </View>
        )}

        <View style={st.divider} />

        {/* ── 2. Service info ──────────────────────────────────────── */}
        <View style={st.infoSection}>
          <Text style={st.serviceName} numberOfLines={1}>{result.title}</Text>
          <View style={st.infoRow}>
            <Text style={st.price}>{priceText(result.pricing_model, result.base_price)}</Text>
            {!isRisingStar && provider.v_reviews > 0 && (
              <>
                <View style={st.infoDot} />
                <Ionicons name="star" size={11} color={palette.warning} />
                <Text style={st.infoMeta}>{provider.r_bayes.toFixed(1)} ({provider.v_reviews})</Text>
              </>
            )}
            {jobCount > 0 && (
              <>
                <View style={st.infoDot} />
                <Text style={st.infoMeta}>{jobCount >= 100 ? '100+' : jobCount} job{jobCount !== 1 ? 's' : ''}</Text>
              </>
            )}
          </View>
          {location && (
            <View style={st.locationRow}>
              <Ionicons name="location" size={12} color={palette.primary} />
              <Text style={st.locationText} numberOfLines={1}>{location}</Text>
            </View>
          )}
        </View>

        <View style={st.divider} />

        {/* ── 3. Provider row ──────────────────────────────────────── */}
        <View style={st.providerRow}>
          <View style={st.avatar}>
            <Text style={st.avatarText}>{initial}</Text>
          </View>
          <View style={st.providerInfo}>
            <View style={st.nameRow}>
              <Text style={st.providerName} numberOfLines={1}>{provider.display_name}</Text>
              {provider.trust_tier >= 2 && (
                <Ionicons name="checkmark-circle" size={14} color={palette.success} />
              )}
            </View>
            <View style={st.pillRow}>
              {isRisingStar ? (
                <View style={st.risingPill}>
                  <Ionicons name="trending-up" size={10} color={palette.warning} />
                  <Text style={st.risingText}>Rising star</Text>
                </View>
              ) : (
                <View style={[st.tierPill, { borderColor: tColor }]}>
                  <Ionicons name="shield-checkmark" size={10} color={tColor} />
                  <Text style={[st.tierText, { color: tColor }]}>{tLabel}</Text>
                </View>
              )}
              {provider.response_time_p50_mins != null && provider.response_time_p50_mins < 30 && (
                <View style={st.quickPill}>
                  <Ionicons name="flash" size={10} color={palette.warning} />
                  <Text style={st.quickText}>Quick</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={st.divider} />

        {/* ── 4. Book button ───────────────────────────────────────── */}
        <Pressable onPress={onBook} style={st.bookRow} accessibilityRole="button" accessibilityLabel={isQuoteFirstModel(result.pricing_model) ? 'Get a quote' : 'Book now'}>
          <Ionicons name="calendar-outline" size={16} color="#fff" />
          <Text style={st.bookText}>
            {isQuoteFirstModel(result.pricing_model) ? 'Get a quote' : 'Book now'}
          </Text>
        </Pressable>
      </View>
    </TouchableRipple>
  );
});

const st = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: HAIRLINE,
    borderColor: palette.border,
    overflow: 'hidden',
  },

  promotedBar: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 5,
    backgroundColor: palette.warningLight,
    borderBottomWidth: HAIRLINE, borderBottomColor: palette.border,
  },
  promotedText: { fontFamily: fontFamily.medium, fontSize: 11, color: palette.warning },

  // Photos
  photoWrap: { position: 'relative' },
  photo: { height: PHOTO_H },
  dotRow: {
    position: 'absolute', bottom: spacing.sm, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5,
  },
  dot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotActive: { width: 16, backgroundColor: '#fff', borderRadius: 3 },
  dotMore:   { fontFamily: fontFamily.medium, fontSize: 10, color: 'rgba(255,255,255,0.8)' },

  photoFallback: {
    height: PHOTO_H,
    alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: palette.primaryLight,
  },
  fallbackIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: palette.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  fallbackText: { fontFamily: fontFamily.medium, fontSize: 13, color: palette.primary },

  divider: { height: HAIRLINE, backgroundColor: palette.border, marginHorizontal: spacing.md },

  // Service info
  infoSection: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, gap: 4 },
  serviceName: { fontFamily: fontFamily.semiBold, fontSize: 15, color: palette.textPrimary },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap' },
  price: { fontFamily: fontFamily.semiBold, fontSize: 13, color: palette.primary },
  infoDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: palette.textDisabled, marginHorizontal: 2 },
  infoMeta: { fontFamily: fontFamily.regular, fontSize: 12, color: palette.textSecondary },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  locationText: { fontFamily: fontFamily.regular, fontSize: 12, color: palette.textSecondary, flex: 1 },

  // Provider
  providerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.primaryLight,
    borderWidth: HAIRLINE, borderColor: palette.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: fontFamily.medium, fontSize: 14, color: palette.primary },
  providerInfo: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  providerName: { fontFamily: fontFamily.medium, fontSize: 13, color: palette.textPrimary, flexShrink: 1 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tierPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: r.full,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  tierText: { fontFamily: fontFamily.medium, fontSize: 10 },
  risingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: palette.warningLight, borderRadius: r.full,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  risingText: { fontFamily: fontFamily.medium, fontSize: 10, color: palette.warning },
  quickPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: palette.warningLight, borderRadius: r.full,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  quickText: { fontFamily: fontFamily.medium, fontSize: 10, color: palette.warning },

  // Book button
  bookRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: palette.primary,
    marginHorizontal: spacing.md, marginVertical: spacing.sm,
    borderRadius: r.sm,
    minHeight: 44,
  },
  bookText: { fontFamily: fontFamily.semiBold, fontSize: 14, color: '#fff' },
});
