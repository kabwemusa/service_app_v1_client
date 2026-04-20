import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Chip, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useCategoryStore } from '../../store/categoryStore';
import { useServiceStore } from '../../store/serviceStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

export default function BrowseScreen({ navigation, route }: any) {
  const initialCategory = route.params?.categoryId as number | undefined;
  const [selectedCategory, setSelectedCategory] = useState<number | undefined>(initialCategory);
  const insets = useSafeAreaInsets();

  const { categories, fetchCategories } = useCategoryStore();
  const { services, loading, error, fetchServices, clearError } = useServiceStore();
  const { showError } = useSnackbar();

  useEffect(() => {
    fetchCategories();
    fetchServices(selectedCategory, true);
  }, [selectedCategory]);

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const handleSelect = (id?: number) => {
    setSelectedCategory(id);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Browse Services</Text>
        <Text style={styles.subtitle}>Find reliable help by category.</Text>
      </View>

      <FlatList
        data={[{ id: undefined, name: 'All' }, ...categories] as any[]}
        keyExtractor={(item) => String(item.id ?? 'all')}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        renderItem={({ item }) => (
          <Chip
            selected={selectedCategory === item.id}
            onPress={() => handleSelect(item.id)}
            style={[
              styles.chip,
              selectedCategory === item.id && styles.chipSelected,
            ]}
            textStyle={[
              styles.chipText,
              selectedCategory === item.id && styles.chipTextSelected,
            ]}
            showSelectedCheck={false}
          >
            {item.name}
          </Chip>
        )}
      />

      {loading && services.length === 0 ? (
        <View style={styles.skeletons}>
          {[1, 2, 3, 4].map((key) => <CardSkeleton key={key} style={styles.skeleton} />)}
        </View>
      ) : (
        <FlatList
          data={services}
          keyExtractor={(service) => service.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 104 }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={44} color={palette.textDisabled} />
              <Text style={styles.emptyTitle}>No services found</Text>
              <Text style={styles.emptyText}>Try another category or check back later.</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableRipple
              onPress={() => navigation.navigate('ServiceDetail', { serviceId: item.id })}
              borderless
              style={styles.card}
            >
              <View style={styles.cardInner}>
                <View style={styles.cardLeft}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.cardCategory}>{item.category?.name}</Text>
                  {item.provider && (
                    <View style={styles.ratingRow}>
                      <Ionicons name="star" size={13} color={palette.warning} />
                      <Text style={styles.ratingText}>
                        {item.provider.r_raw.toFixed(1)} | {item.provider.v_reviews} reviews
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.cardRight}>
                  <Text style={styles.price}>ZMW {item.base_price.toFixed(0)}</Text>
                  {item.distance_km !== null && (
                    <Text style={styles.distance}>{item.distance_km} km</Text>
                  )}
                  <Ionicons name="chevron-forward" size={18} color={palette.textDisabled} />
                </View>
              </View>
            </TouchableRipple>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.heading2,
    color: palette.textPrimary,
    marginBottom: 2,
  },
  subtitle: {
    ...typography.bodySmall,
    color: palette.textSecondary,
  },

  chips: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: r.full,
    height: 38,
  },
  chipSelected: { backgroundColor: palette.primary, borderColor: palette.primary },
  chipText: { ...typography.bodySmall, color: palette.textSecondary },
  chipTextSelected: { color: '#FFFFFF' },

  list: { paddingHorizontal: spacing.lg },
  skeletons: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  skeleton: { height: 98, borderRadius: r.lg },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    ...shadow.card,
  },
  cardInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
  cardLeft: { flex: 1, marginRight: spacing.sm },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  cardTitle: {
    ...typography.label,
    color: palette.textPrimary,
    fontSize: 16,
    marginBottom: 3,
  },
  cardCategory: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    marginBottom: spacing.xs,
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { ...typography.bodySmall, color: palette.textSecondary },
  price: {
    ...typography.label,
    color: palette.primary,
    fontSize: 16,
  },
  distance: { ...typography.bodySmall, color: palette.textSecondary },

  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
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
