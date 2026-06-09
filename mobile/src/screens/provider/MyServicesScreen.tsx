import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { FAB, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Service, ServiceStatus } from '../../api/services';
import { priceLabel } from '../../components/discovery/RankedServiceCard';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useServiceStore } from '../../store/serviceStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

// §6.7 — listings carry a `status` (DRAFT/ACTIVE/PAUSED/HIDDEN), not a boolean.
const STATUS_META: Record<ServiceStatus, { color: string; label: string }> = {
  ACTIVE: { color: palette.success,      label: 'Active'  },
  DRAFT:  { color: palette.warning,      label: 'Draft'   },
  PAUSED: { color: palette.textDisabled, label: 'Paused'  },
  HIDDEN: { color: palette.danger,       label: 'Hidden'  },
};

export default function MyServicesScreen({ navigation }: any) {
  const { myServices, loading, error, fetchMyServices, deleteService, clearError } = useServiceStore();
  const { showSuccess, showError } = useSnackbar();
  const tabBarHeight = useBottomTabBarHeight();
  const showBack = navigation.canGoBack();

  useEffect(() => {
    fetchMyServices(true);
  }, []);

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const handleDelete = (service: Service) => {
    Alert.alert(
      'Delete Service',
      `Remove "${service.title}" from your listings?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            try {
              await deleteService(service.id);
              showSuccess('Service deleted.');
            } catch {}
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        {showBack ? (
          <TouchableRipple onPress={() => navigation.goBack()} borderless style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={palette.textPrimary} />
          </TouchableRipple>
        ) : (
          <View style={styles.backBtnPlaceholder} />
        )}
        <View style={styles.headerText}>
          <Text style={styles.title}>My Services</Text>
          <Text style={styles.subtitle}>Manage active listings and pricing.</Text>
        </View>
      </View>

      {loading && myServices.length === 0 ? (
        <View style={styles.skeletons}>
          {[1, 2, 3].map((key) => <CardSkeleton key={key} style={styles.skeleton} />)}
        </View>
      ) : (
        <FlatList
          data={myServices}
          keyExtractor={(service) => service.id}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarHeight + 80 }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Ionicons name="construct-outline" size={48} color={palette.textDisabled} />
              <Text style={styles.emptyTitle}>No services yet</Text>
              <Text style={styles.emptyBody}>Tap the + button to create your first listing.</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <TouchableRipple
                onPress={() => navigation.navigate('CreateService', { service: item })}
                style={styles.cardMain}
                borderless
              >
                <View style={styles.cardInner}>
                  <View style={[styles.activeDot, { backgroundColor: STATUS_META[item.status].color }]} />
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <View style={styles.cardMetaRow}>
                      <Text style={styles.cardCategory}>{item.category?.name}</Text>
                      {item.status !== 'ACTIVE' && (
                        <>
                          <Text style={styles.metaDot}>·</Text>
                          <Text style={[styles.statusLabel, { color: STATUS_META[item.status].color }]}>
                            {STATUS_META[item.status].label}
                          </Text>
                        </>
                      )}
                    </View>
                  </View>
                  <Text style={styles.cardPrice}>{priceLabel(item.pricing_model, item.base_price)}</Text>
                </View>
              </TouchableRipple>
              <TouchableRipple
                onPress={() => navigation.navigate('ServicePhotos', {
                  serviceId: item.id,
                  serviceTitle: item.title,
                })}
                style={styles.iconBtn}
                borderless
              >
                <Ionicons name="camera-outline" size={18} color={palette.primary} />
              </TouchableRipple>
              <TouchableRipple onPress={() => handleDelete(item)} style={styles.iconBtn} borderless>
                <Ionicons name="trash-outline" size={18} color={palette.danger} />
              </TouchableRipple>
            </View>
          )}
        />
      )}

      <FAB
        icon="plus"
        style={[styles.fab, { bottom: tabBarHeight + spacing.sm }]}
        onPress={() => navigation.navigate('CreateService', { service: undefined })}
        color="#FFFFFF"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
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
  backBtnPlaceholder: {
    width: 36,
    height: 36,
  },
  headerText: { flex: 1 },
  title: { ...typography.heading2, color: palette.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.bodySmall, color: palette.textSecondary },

  skeletons: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  skeleton: { height: 92, borderRadius: r.lg },

  list: { paddingHorizontal: spacing.lg },
  card: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    ...shadow.card,
  },
  cardMain: { flex: 1 },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  activeDot: {
    width: 9,
    height: 9,
    borderRadius: r.full,
    backgroundColor: palette.success,
  },
  cardBody: { flex: 1 },
  cardTitle: { ...typography.label, color: palette.textPrimary, fontSize: 16, marginBottom: 3 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardCategory: { ...typography.bodySmall, color: palette.textSecondary },
  metaDot: { color: palette.textDisabled, fontSize: 12 },
  statusLabel: { ...typography.bodySmall, fontSize: 12 },
  cardPrice: { ...typography.label, color: palette.primary, fontSize: 16 },
  deleteBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderLeftWidth: 1,
    borderLeftColor: palette.border,
  },
  iconBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderLeftWidth: 1,
    borderLeftColor: palette.border,
  },

  empty: {
    alignItems: 'center',
    paddingTop: spacing.xxl * 2,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    ...typography.heading3,
    color: palette.textPrimary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  emptyBody: { ...typography.body, color: palette.textSecondary, textAlign: 'center' },

  fab: {
    position: 'absolute',
    right: spacing.lg,
    backgroundColor: palette.primary,
  },
});
