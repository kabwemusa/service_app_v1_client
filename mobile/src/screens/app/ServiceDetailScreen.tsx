import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, FlatList, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View } from 'react-native';
import { Button, TouchableRipple, Text } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { ApiError } from '../../api/errors';

const SCREEN_W = Dimensions.get('window').width;
const CAROUSEL_H = 240;
import { Service, servicesApi } from '../../api/services';
import { storageUrl } from '../../api/client';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

export default function ServiceDetailScreen({ navigation, route }: any) {
  const serviceId: string = route.params?.serviceId;
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  const { showError } = useSnackbar();
  const insets = useSafeAreaInsets();
  const carouselRef = useRef<FlatList>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await servicesApi.show(serviceId);
        setService(data);
      } catch (error) {
        showError(error instanceof ApiError ? error.message : 'Failed to load service.');
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [serviceId]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.navBar}>
        <TouchableRipple onPress={() => navigation.goBack()} borderless style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={palette.textPrimary} />
        </TouchableRipple>
        <Text style={styles.navTitle}>Service details</Text>
        <View style={styles.backBtnPlaceholder} />
      </View>

      {loading || !service ? (
        <View style={styles.skeletons}>
          <CardSkeleton style={styles.skeletonTitle} />
          <CardSkeleton style={styles.skeletonBody} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Photo carousel */}
          {service.photos && service.photos.length > 0 ? (
            <View style={styles.carouselWrapper}>
              <FlatList
                ref={carouselRef}
                data={service.photos}
                keyExtractor={(p) => String(p.id)}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
                  setPhotoIndex(idx);
                }}
                scrollEventThrottle={16}
                renderItem={({ item }) => (
                  <Image
                    source={{ uri: storageUrl(item.path) }}
                    style={styles.carouselImage}
                    contentFit="cover"
                    transition={200}
                  />
                )}
              />
              {service.photos.length > 1 && (
                <View style={styles.dotRow}>
                  {service.photos.map((_, i) => (
                    <View
                      key={i}
                      style={[styles.dot, i === photoIndex && styles.dotActive]}
                    />
                  ))}
                </View>
              )}
            </View>
          ) : null}

          <View style={styles.badge}>
            <Text style={styles.badgeText}>{service.category?.name}</Text>
          </View>

          <Text style={styles.title}>{service.title}</Text>

          <View style={styles.priceCard}>
            <Text style={styles.price}>ZMW {service.base_price.toFixed(2)}</Text>
            {service.distance_km !== null && (
              <View style={styles.distanceRow}>
                <Ionicons name="location-outline" size={14} color={palette.textSecondary} />
                <Text style={styles.distance}>{service.distance_km} km away</Text>
              </View>
            )}
          </View>

          {service.provider && (
            <TouchableRipple
              borderless
              style={styles.providerCard}
              onPress={() => navigation.navigate('ProviderProfile', { providerId: service.provider!.id })}
            >
              <View style={styles.providerCardInner}>
                <View style={styles.providerIcon}>
                  <Ionicons name="person-circle-outline" size={36} color={palette.primary} />
                </View>
                <View style={styles.providerBody}>
                  <Text style={styles.providerLabel}>Service Provider</Text>
                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={14} color={palette.warning} />
                    <Text style={styles.ratingText}>
                      {service.provider.r_raw.toFixed(1)} · {service.provider.v_reviews} reviews
                    </Text>
                  </View>
                  <Text style={styles.completionText}>
                    {Math.round(service.provider.completion_rate * 100)}% completion rate
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={palette.textDisabled} />
              </View>
            </TouchableRipple>
          )}

          {service.description && (
            <View style={styles.aboutCard}>
              <Text style={styles.sectionLabel}>About this service</Text>
              <MarkdownView>{service.description}</MarkdownView>
            </View>
          )}

          <Button
            mode="contained"
            style={styles.bookBtn}
            contentStyle={styles.bookBtnContent}
            labelStyle={styles.bookBtnLabel}
            onPress={() => navigation.navigate('Booking', {
              serviceId:    service.id,
              serviceTitle: service.title,
              basePrice:    service.base_price,
            })}
          >
            Book Now
          </Button>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: r.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  backBtnPlaceholder: { width: 36 },
  navTitle: {
    ...typography.label,
    color: palette.textSecondary,
  },

  skeletons: { paddingHorizontal: spacing.lg, gap: spacing.md },
  skeletonTitle: { height: 34, borderRadius: r.md },
  skeletonBody: { height: 220, borderRadius: r.lg },

  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: palette.primaryLight,
    borderRadius: r.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  badgeText: { ...typography.bodySmall, color: palette.primary },
  title: {
    ...typography.heading1,
    color: palette.textPrimary,
    marginBottom: spacing.md,
  },

  priceCard: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  price: { ...typography.price, color: palette.primary, marginBottom: spacing.xs },
  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distance: { ...typography.bodySmall, color: palette.textSecondary },

  providerCard: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...shadow.card,
  },
  providerCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  providerIcon: {},
  providerBody: { flex: 1 },
  providerLabel: { ...typography.label, color: palette.textSecondary, marginBottom: 3 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  ratingText: { ...typography.bodySmall, color: palette.textSecondary },
  completionText: { ...typography.bodySmall, color: palette.success },

  aboutCard: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  sectionLabel: {
    ...typography.label,
    color: palette.textSecondary,
    marginBottom: spacing.xs,
  },
  description: { ...typography.body, color: palette.textPrimary },

  bookBtn: {
    borderRadius: r.lg,
  },
  bookBtnContent: { height: 54 },
  bookBtnLabel: { ...typography.label, fontSize: 16, letterSpacing: 0.2 },

  carouselWrapper: {
    marginHorizontal: -spacing.lg,
    marginBottom: spacing.md,
  },
  carouselImage: {
    width: SCREEN_W,
    height: CAROUSEL_H,
  },
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.border,
  },
  dotActive: {
    width: 18,
    backgroundColor: palette.primary,
  },
});
