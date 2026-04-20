import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Booking, BookingStatus } from '../../api/bookings';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useBookingStore } from '../../store/bookingStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING_PAYMENT:   'Awaiting Payment',
  AWAITING_KYC:      'KYC Required',
  FUNDS_HELD:        'Payment Held',
  IN_PROGRESS:       'In Progress',
  DELIVERED:         'Delivered',
  COMPLETED:         'Completed',
  DISPUTED:          'Disputed',
  CHARGEBACK_PENDING: 'Chargeback Pending',
  DISBURSED:         'Disbursed',
  CANCELLED:         'Cancelled',
};

const STATUS_COLOR: Record<BookingStatus, string> = {
  PENDING_PAYMENT:   palette.warning,
  AWAITING_KYC:      palette.warning,
  FUNDS_HELD:        palette.primary,
  IN_PROGRESS:       palette.primary,
  DELIVERED:         palette.secondary,
  COMPLETED:         palette.success,
  DISPUTED:          palette.danger,
  CHARGEBACK_PENDING: palette.danger,
  DISBURSED:         palette.success,
  CANCELLED:         palette.textSecondary,
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZM', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function BookingCard({ booking, onPress }: { booking: Booking; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardTop}>
        <Text style={styles.serviceTitle} numberOfLines={1}>{booking.service.title}</Text>
        <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[booking.status] }]} />
      </View>

      <Text style={styles.statusLabel} numberOfLines={1}>
        {STATUS_LABEL[booking.status]}
      </Text>

      <View style={styles.cardBottom}>
        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={13} color={palette.textSecondary} />
          <Text style={styles.dateTxt}>{fmtDate(booking.scheduled_start)}</Text>
        </View>
        <Text style={styles.priceTxt}>ZMW {booking.service.base_price.toFixed(2)}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function BookingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { showError } = useSnackbar();
  const {
    bookings, loading, error, page, lastPage,
    fetchBookings, loadMore, clearError,
  } = useBookingStore();

  useEffect(() => {
    fetchBookings(true);
  }, []);

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const renderItem = useCallback(({ item }: { item: Booking }) => (
    <BookingCard
      booking={item}
      onPress={() => navigation.navigate('BookingDetail', { bookingId: item.id })}
    />
  ), [navigation]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Bookings</Text>
        <Text style={styles.subtitle}>Track your upcoming and completed service requests.</Text>
      </View>

      {loading && bookings.length === 0 ? (
        <View style={styles.skeletons}>
          {[1, 2, 3].map((k) => <CardSkeleton key={k} style={styles.skeleton} />)}
        </View>
      ) : bookings.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.iconBadge}>
            <Ionicons name="calendar-outline" size={40} color={palette.primary} />
          </View>
          <Text style={styles.emptyTitle}>No bookings yet</Text>
          <Text style={styles.emptyBody}>
            Once you book a service, details and status updates will appear here.
          </Text>
        </View>
      ) : (
        <FlashList
          data={bookings}
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          // @ts-ignore — estimatedItemSize is a valid FlashList perf hint
          estimatedItemSize={110}
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loading && page < lastPage
              ? <ActivityIndicator style={{ marginVertical: spacing.md }} color={palette.primary} />
              : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background, paddingHorizontal: spacing.lg },
  header: { paddingTop: spacing.md, paddingBottom: spacing.lg },
  title: { ...typography.heading2, color: palette.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.bodySmall, color: palette.textSecondary },

  skeletons: { gap: spacing.sm },
  skeleton: { height: 108, borderRadius: r.lg },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  serviceTitle: { ...typography.label, color: palette.textPrimary, flex: 1, marginRight: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { ...typography.bodySmall, color: palette.textSecondary, marginBottom: spacing.sm },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateTxt: { ...typography.bodySmall, color: palette.textSecondary },
  priceTxt: { ...typography.label, color: palette.primary },

  emptyCard: {
    marginTop: spacing.md,
    borderRadius: r.xl,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    ...shadow.card,
  },
  iconBadge: {
    width: 82, height: 82, borderRadius: r.full,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.primaryLight,
    marginBottom: spacing.md,
  },
  emptyTitle: { ...typography.heading3, color: palette.textPrimary, marginBottom: spacing.xs, textAlign: 'center' },
  emptyBody: { ...typography.body, color: palette.textSecondary, textAlign: 'center', maxWidth: 280 },
});
