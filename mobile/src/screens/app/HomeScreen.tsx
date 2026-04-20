import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useCategoryStore } from '../../store/categoryStore';
import { useServiceStore } from '../../store/serviceStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

const CATEGORY_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  Tutoring: 'book-outline',
  Laundry: 'water-outline',
  Photography: 'camera-outline',
  Delivery: 'bicycle-outline',
  'Graphic Design': 'brush-outline',
  'Hair & Beauty': 'cut-outline',
  Cleaning: 'sparkles-outline',
  'Tech Support': 'hardware-chip-outline',
};

export default function HomeScreen({ navigation }: any) {
  const { categories, fetchCategories, loading: cLoading } = useCategoryStore();
  const { services, fetchServices, loading: sLoading } = useServiceStore();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    fetchCategories();
    fetchServices(undefined, true);
  }, []);

  const handleCategoryPress = (categoryId: number) => {
    navigation.navigate('Search', { screen: 'BrowseMain', params: { categoryId } });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 104 }]}
      >
        <LinearGradient
          colors={['#7B1A3A', '#C2476A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.brand}>sebenza</Text>
              <Text style={styles.heroTitle}>Work gets done. Stress stays low.</Text>
            </View>
            <TouchableOpacity style={styles.notifBtn}>
              <Ionicons name="notifications-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={styles.heroSubtitle}>
            Book trusted student services near you in a few taps.
          </Text>
        </LinearGradient>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Categories</Text>
        </View>

        {cLoading && categories.length === 0 ? (
          <View style={styles.categoryRow}>
            {[1, 2, 3, 4].map((key) => (
              <CardSkeleton key={key} style={styles.categoryCardSkeleton} />
            ))}
          </View>
        ) : (
          <FlatList
            data={categories}
            keyExtractor={(category) => String(category.id)}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryList}
            renderItem={({ item }) => (
              <TouchableRipple
                onPress={() => handleCategoryPress(item.id)}
                borderless
                style={styles.categoryCard}
              >
                <View style={styles.categoryCardInner}>
                  <View style={styles.categoryIcon}>
                    <Ionicons
                      name={CATEGORY_ICONS[item.name] ?? 'grid-outline'}
                      size={22}
                      color={palette.primary}
                    />
                  </View>
                  <Text style={styles.categoryName}>{item.name}</Text>
                </View>
              </TouchableRipple>
            )}
          />
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Available Services</Text>
          <TouchableRipple onPress={() => navigation.navigate('Search')} borderless style={styles.seeAllBtn}>
            <Text style={styles.seeAll}>See all</Text>
          </TouchableRipple>
        </View>

        {sLoading && services.length === 0 ? (
          [1, 2, 3].map((key) => <CardSkeleton key={key} style={styles.serviceCardSkeleton} />)
        ) : services.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={42} color={palette.textDisabled} />
            <Text style={styles.emptyTitle}>No services available yet</Text>
            <Text style={styles.emptyText}>New listings will show up here automatically.</Text>
          </View>
        ) : (
          services.slice(0, 6).map((service) => (
            <TouchableRipple
              key={service.id}
              onPress={() => navigation.navigate('ServiceDetail', { serviceId: service.id })}
              borderless
              style={styles.serviceCard}
            >
              <View style={styles.serviceCardInner}>
                <View style={styles.serviceCardLeft}>
                  <Text style={styles.serviceTitle} numberOfLines={1}>{service.title}</Text>
                  <Text style={styles.serviceCategory}>{service.category?.name}</Text>
                  {service.provider && (
                    <View style={styles.ratingRow}>
                      <Ionicons name="star" size={13} color={palette.warning} />
                      <Text style={styles.ratingText}>
                        {service.provider.r_raw.toFixed(1)} ({service.provider.v_reviews} reviews)
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.serviceCardRight}>
                  <Text style={styles.servicePrice}>ZMW {service.base_price.toFixed(0)}</Text>
                  {service.distance_km !== null && (
                    <Text style={styles.distanceText}>{service.distance_km} km away</Text>
                  )}
                  <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
                </View>
              </View>
            </TouchableRipple>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  heroCard: {
    borderRadius: r.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  brand: {
    ...typography.label,
    color: '#DCEBFF',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: spacing.xs,
  },
  heroTitle: {
    ...typography.heading2,
    color: '#FFFFFF',
    maxWidth: 240,
  },
  heroSubtitle: {
    ...typography.bodySmall,
    color: '#EEF6FF',
    marginTop: spacing.sm,
    maxWidth: 260,
  },
  notifBtn: {
    width: 40,
    height: 40,
    borderRadius: r.full,
    backgroundColor: '#FFFFFF2E',
    borderWidth: 1,
    borderColor: '#FFFFFF3D',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    ...typography.heading3,
    color: palette.textPrimary,
    fontSize: 19,
  },
  seeAllBtn: {
    borderRadius: r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  seeAll: {
    ...typography.label,
    color: palette.primary,
  },

  categoryList: { gap: spacing.sm, paddingBottom: spacing.sm },
  categoryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  categoryCardSkeleton: { width: 96, height: 108, borderRadius: r.lg },
  categoryCard: {
    borderRadius: r.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
    ...shadow.card,
  },
  categoryCardInner: {
    width: 96,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: spacing.xs,
  },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryName: {
    ...typography.bodySmall,
    color: palette.textPrimary,
    textAlign: 'center',
  },

  serviceCardSkeleton: { height: 96, borderRadius: r.lg, marginBottom: spacing.sm },
  serviceCard: {
    borderRadius: r.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    ...shadow.card,
  },
  serviceCardInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
  serviceCardLeft: { flex: 1, marginRight: spacing.sm },
  serviceCardRight: { alignItems: 'flex-end', gap: 2 },
  serviceTitle: {
    ...typography.label,
    color: palette.textPrimary,
    fontSize: 16,
    marginBottom: 3,
  },
  serviceCategory: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    marginBottom: spacing.xs,
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { ...typography.bodySmall, color: palette.textSecondary },
  servicePrice: {
    ...typography.label,
    color: palette.primary,
    fontSize: 16,
  },
  distanceText: {
    ...typography.bodySmall,
    color: palette.textSecondary,
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    ...typography.heading3,
    color: palette.textPrimary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  emptyText: {
    ...typography.body,
    color: palette.textSecondary,
    textAlign: 'center',
  },
});
