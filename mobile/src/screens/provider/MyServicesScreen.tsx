import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { storageUrl } from '../../api/client';
import { Service, ServiceStatus, servicesApi } from '../../api/services';
import { priceLabel } from '../../components/discovery/RankedServiceCard';
import { ConfirmDialog, ConfirmDialogConfig } from '../../components/ui/ConfirmDialog';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { TabItem, Tabs } from '../../components/ui/Tabs';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useServiceStore } from '../../store/serviceStore';
import { palette, radius as r, spacing, typography } from '../../theme';

// Three list buckets. HIDDEN sits with PAUSED — both are "configured but not live".
type TabKey = 'ACTIVE' | 'PAUSED' | 'DRAFT';

function bucketFor(status: ServiceStatus): TabKey {
  if (status === 'ACTIVE') return 'ACTIVE';
  if (status === 'DRAFT') return 'DRAFT';
  return 'PAUSED';
}

// Status pill copy — conveyed by text, not colour alone (§2 a11y).
const PILL: Record<ServiceStatus, { label: string; fg: string; bg: string }> = {
  ACTIVE: { label: 'Active', fg: palette.success,      bg: palette.successLight },
  DRAFT:  { label: 'Draft',  fg: palette.warning,      bg: palette.warningLight },
  PAUSED: { label: 'Paused', fg: palette.textSecondary, bg: palette.primaryLight },
  HIDDEN: { label: 'Hidden', fg: palette.danger,       bg: palette.dangerLight },
};

const EMPTY_COPY: Record<TabKey, { title: string; body: string }> = {
  ACTIVE: { title: 'No active services', body: 'Publish a service to start getting booked.' },
  PAUSED: { title: 'No paused services', body: 'Services you pause will appear here.' },
  DRAFT:  { title: 'No drafts',          body: 'Unfinished services are saved here as drafts.' },
};

// Concise "what's missing" line for a draft card (§ list spec).
function draftMissing(svc: Service): string {
  const missing: string[] = [];
  if (!svc.title?.trim()) missing.push('title');
  if (!svc.category)      missing.push('category');
  if (svc.pricing_model === 'OUTCOME_FIXED' && svc.base_price == null) missing.push('price');
  if (svc.pricing_model === 'HOURLY_CAPPED' && (svc.hourly_rate == null || svc.cap_hours == null)) missing.push('rate & cap');
  if (svc.needs_pricing_review) missing.push('cap review');
  if (!svc.inclusions?.length) missing.push("what's included");
  return missing.length ? `Missing ${missing.join(', ')}` : 'Ready to publish';
}

// Thumbnail with broken-image → category-tint fallback (§ list states).
function ServiceThumb({ service }: { service: Service }) {
  const [failed, setFailed] = useState(false);
  const photo = service.photos?.[0];
  if (photo && !failed) {
    return (
      <Image
        source={{ uri: storageUrl(photo.path) }}
        style={styles.thumb}
        contentFit="cover"
        transition={120}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.thumb, styles.thumbEmpty]}>
      <Ionicons name="pricetag-outline" size={20} color={palette.primary} />
    </View>
  );
}

export default function MyServicesScreen({ navigation }: any) {
  const { myServices, loading, error, fetchMyServices, deleteService, patchService, clearError } = useServiceStore();
  const { showSuccess, showError } = useSnackbar();
  const tabBarHeight = useBottomTabBarHeight();

  const [tab, setTab] = useState<TabKey>('ACTIVE');
  const [dialog, setDialog] = useState<ConfirmDialogConfig | null>(null);

  useEffect(() => { fetchMyServices(true); }, []);

  useEffect(() => {
    if (error) { showError(error.message); clearError(); }
  }, [error]);

  const counts = useMemo(() => {
    const c = { ACTIVE: 0, PAUSED: 0, DRAFT: 0 } as Record<TabKey, number>;
    myServices.forEach((s) => { c[bucketFor(s.status)] += 1; });
    return c;
  }, [myServices]);

  const tabs: TabItem[] = [
    { key: 'ACTIVE', label: 'Active', count: counts.ACTIVE },
    { key: 'PAUSED', label: 'Paused', count: counts.PAUSED },
    { key: 'DRAFT',  label: 'Drafts', count: counts.DRAFT },
  ];

  const visible = useMemo(
    () => myServices.filter((s) => bucketFor(s.status) === tab),
    [myServices, tab],
  );

  const openEditor = (service?: Service) =>
    navigation.navigate('CreateService', { service });

  const handleDelete = (service: Service) => {
    setDialog({
      title: 'Delete service',
      message: `Remove "${service.title}" from your listings?`,
      destructive: true,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setDialog(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        try {
          await deleteService(service.id);
          showSuccess('Service deleted.');
        } catch {}
      },
    });
  };

  // Pause / activate — optimistic with rollback on failure (§ list spec).
  const toggleStatus = async (service: Service) => {
    const next: ServiceStatus = service.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    Haptics.selectionAsync();
    patchService(service.id, { status: next });
    try {
      await servicesApi.update(service.id, { status: next });
      showSuccess(next === 'ACTIVE' ? 'Service activated.' : 'Service paused.');
    } catch (e: any) {
      patchService(service.id, { status: service.status });
      showError(e?.message ?? 'Could not update the service.');
    }
  };

  const renderCard = ({ item }: { item: Service }) => {
    const pill   = PILL[item.status];
    const isDraft = item.status === 'DRAFT';
    const mins   = item.duration_estimate_mins;
    return (
      <View style={styles.card}>
        {/* Info */}
        <TouchableRipple onPress={() => openEditor(item)} borderless style={styles.infoTap}>
          <View style={styles.infoRow}>
            <ServiceThumb service={item} />
            <View style={styles.infoBody}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title || 'Untitled service'}</Text>
                <View style={[styles.pill, { backgroundColor: pill.bg }]}>
                  <Text style={[styles.pillText, { color: pill.fg }]}>{pill.label}</Text>
                </View>
              </View>
              <Text style={styles.priceLine} numberOfLines={1}>
                {priceLabel(item.pricing_model, item.base_price)}
                {mins ? `  ·  ${mins} min` : ''}
              </Text>
            </View>
          </View>
        </TouchableRipple>

        <View style={styles.divider} />

        {/* Action row */}
        <View style={styles.actionRow}>
          <Text style={styles.stat} numberOfLines={1}>
            {isDraft ? draftMissing(item) : `${item.bookings_count ?? 0} booked`}
          </Text>

          <View style={styles.actions}>
            {isDraft ? (
              <TouchableRipple onPress={() => openEditor(item)} borderless style={styles.actionBtn}>
                <Text style={styles.actionPrimary}>Finish setup</Text>
              </TouchableRipple>
            ) : (
              <>
                <TouchableRipple onPress={() => openEditor(item)} borderless style={styles.actionBtn}>
                  <Text style={styles.actionText}>Edit</Text>
                </TouchableRipple>
                <TouchableRipple onPress={() => toggleStatus(item)} borderless style={styles.actionBtn}>
                  <Text style={styles.actionText}>{item.status === 'ACTIVE' ? 'Pause' : 'Activate'}</Text>
                </TouchableRipple>
              </>
            )}
            <TouchableRipple
              onPress={() => handleDelete(item)}
              borderless
              style={styles.iconBtn}
              accessibilityLabel={`Delete ${item.title}`}
            >
              <Ionicons name="trash-outline" size={18} color={palette.danger} />
            </TouchableRipple>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScreenHeader
        title="Services"
        right={
          <TouchableRipple
            onPress={() => openEditor(undefined)}
            borderless
            style={styles.addBtn}
            accessibilityLabel="Add a service"
          >
            <View style={styles.addInner}>
              <Ionicons name="add" size={18} color="#FFFFFF" />
              <Text style={styles.addText}>Add</Text>
            </View>
          </TouchableRipple>
        }
      />

      <Tabs items={tabs} activeKey={tab} onChange={(k) => setTab(k as TabKey)} />

      {loading && myServices.length === 0 ? (
        <View style={styles.skeletons}>
          {[1, 2, 3].map((k) => <CardSkeleton key={k} style={styles.skeleton} />)}
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(s) => s.id}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarHeight + spacing.xl }]}
          showsVerticalScrollIndicator={false}
          renderItem={renderCard}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Ionicons name="construct-outline" size={44} color={palette.textDisabled} />
              <Text style={styles.emptyTitle}>{EMPTY_COPY[tab].title}</Text>
              <Text style={styles.emptyBody}>{EMPTY_COPY[tab].body}</Text>
            </View>
          )}
        />
      )}

      <ConfirmDialog dialog={dialog} onDismiss={() => setDialog(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { ...typography.heading2, color: palette.textPrimary },
  addBtn: { borderRadius: r.sm, backgroundColor: palette.primary },
  addInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  addText: { ...typography.label, color: '#FFFFFF', fontSize: 15 },

  skeletons: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  skeleton: { height: 110, borderRadius: r.sm },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  // 8px-family small radius on cards (§ design constraints) — no lg/xl.
  card: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },

  infoTap: { borderRadius: r.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  thumb: { width: 56, height: 56, borderRadius: r.sm },
  thumbEmpty: {
    backgroundColor: palette.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBody: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { ...typography.label, color: palette.textPrimary, fontSize: 16, flex: 1 },
  pill: { borderRadius: r.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  pillText: { ...typography.bodySmall, fontSize: 12, fontFamily: 'DMSans_500Medium' },
  priceLine: { ...typography.body, color: palette.textSecondary, fontSize: 14 },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    minHeight: 44,
  },
  stat: { ...typography.bodySmall, color: palette.textSecondary, flex: 1, fontSize: 13 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: r.sm,
  },
  actionText:    { ...typography.label, color: palette.textPrimary, fontSize: 14 },
  actionPrimary: { ...typography.label, color: palette.primary, fontSize: 14 },
  iconBtn: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: r.sm,
  },

  empty: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyTitle: { ...typography.heading3, color: palette.textPrimary, marginTop: spacing.sm, marginBottom: spacing.xs },
  emptyBody: { ...typography.body, color: palette.textSecondary, textAlign: 'center' },
});
