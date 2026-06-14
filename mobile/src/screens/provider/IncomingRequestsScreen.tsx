import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, Portal, ProgressBar, SegmentedButtons, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { IncomingRequestEntry, TrustHint } from '../../api/bookings';
import { ApiError } from '../../api/errors';
import { ProviderRequestFeedEntry, serviceRequestsApi } from '../../api/serviceRequests';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useBookingStore } from '../../store/bookingStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type TabKey = 'new' | 'scheduled' | 'leads';

// §8 — discreet, qualitative buyer trust hint. "New customer" is deliberately
// neutral (never a warning colour): v3 §10.2 already blocks risky buyers
// server-side, so a warning tint here would just bias providers against them.
const TRUST_HINT_META: Record<TrustHint, { label: string; icon: IconName; color: string; bg: string }> = {
  REPEAT_CLIENT: { label: 'Repeat client',    icon: 'heart',                    color: palette.success,       bg: palette.successLight },
  TRUSTED:       { label: 'Trusted customer', icon: 'shield-checkmark-outline', color: palette.primary,       bg: palette.primaryLight },
  NEW:           { label: 'New customer',     icon: 'person-add-outline',       color: palette.textSecondary, bg: '#EFEFEF'            },
};

function timeSince(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatScheduled(iso: string | null): string {
  if (!iso) return 'Time to be confirmed';
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function RequestCard({ entry, onPress }: { entry: IncomingRequestEntry; onPress: () => void }) {
  const hint = TRUST_HINT_META[entry.trust_hint];
  const locationLabel = entry.delivery_label ?? entry.delivery_region ?? 'Location on file';
  const isDirect = entry.payment_mode === 'DIRECT';

  return (
    <TouchableRipple onPress={onPress} borderless style={styles.cardWrap}>
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={18} color={palette.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.buyerName} numberOfLines={1}>{entry.buyer_label}</Text>
            <View style={[styles.hintPill, { backgroundColor: hint.bg }]}>
              <Ionicons name={hint.icon} size={11} color={hint.color} />
              <Text style={[styles.hintText, { color: hint.color }]}>{hint.label}</Text>
            </View>
          </View>
          {!!entry.created_at && (
            <View style={styles.timerPill}>
              <Ionicons name="time-outline" size={12} color={palette.textSecondary} />
              <Text style={styles.timerText}>{timeSince(entry.created_at)}</Text>
            </View>
          )}
        </View>

        <Text style={styles.serviceTitle} numberOfLines={1}>{entry.service_title ?? 'Service'}</Text>

        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={14} color={palette.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1}>{formatScheduled(entry.scheduled_start)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={14} color={palette.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1}>
            {locationLabel}{entry.distance_km != null ? ` · ${entry.distance_km} km away` : ''}
          </Text>
        </View>

        <View style={styles.netRow}>
          <Text style={styles.netText} numberOfLines={1}>
            {isDirect ? (
              <>You’ll be paid <Text style={styles.netStrong}>ZMW {entry.gross_zmw.toFixed(0)}</Text> directly</>
            ) : (
              <>You keep <Text style={styles.netStrong}>ZMW {entry.net_zmw.toFixed(0)}</Text> of ZMW {entry.gross_zmw.toFixed(0)}</>
            )}
          </Text>
          {entry.pricing_model === 'QUOTE' && (
            <Chip compact mode="flat" style={styles.quoteChip} textStyle={styles.quoteChipText}>By quote</Chip>
          )}
        </View>

        <View style={styles.escrowRow}>
          <Ionicons
            name={isDirect ? 'cash-outline' : 'lock-closed-outline'}
            size={13}
            color={palette.success}
          />
          <Text style={styles.escrowText} numberOfLines={1}>{entry.escrow_label}</Text>
          <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
        </View>
      </View>
    </TouchableRipple>
  );
}

/** Minutes left on the 30-minute response deadline — drives the urgency pill. */
function deadlineLabel(respondBy: string): { text: string; expired: boolean } {
  const diff = new Date(respondBy).getTime() - Date.now();
  if (diff <= 0) return { text: 'Deadline passed', expired: true };
  const m = Math.ceil(diff / 60_000);
  return { text: m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m to reply` : `${m}m to reply`, expired: false };
}

function formatWindow(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end   = new Date(endIso);
  const day   = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time  = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time(start)}–${time(end)}`;
}

/** v3.2 §6 — one broadcast job lead: §6.8 card layout plus budget + window. */
function LeadCard({
  entry, onAccept, onQuote,
}: {
  entry: ProviderRequestFeedEntry;
  onAccept: () => void;
  onQuote: () => void;
}) {
  const deadline  = deadlineLabel(entry.respond_by);
  const responded = entry.my_response != null;
  const canAccept = entry.service.base_price != null && entry.service.pricing_model !== 'QUOTE';

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.avatar, { backgroundColor: palette.warningLight }]}>
          <Ionicons name="megaphone-outline" size={16} color={palette.warning} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.buyerName} numberOfLines={1}>{entry.category_name} request</Text>
          {entry.budget_zmw != null && (
            <Text style={styles.leadBudget}>Budget ZMW {entry.budget_zmw.toFixed(0)}</Text>
          )}
        </View>
        {!responded && (
          <View style={[styles.timerPill, deadline.expired && { backgroundColor: '#EFEFEF' }]}>
            <Ionicons name="time-outline" size={12} color={deadline.expired ? palette.textDisabled : palette.warning} />
            <Text style={[styles.timerText, !deadline.expired && { color: palette.warning }]}>{deadline.text}</Text>
          </View>
        )}
      </View>

      <Text style={styles.leadDescription} numberOfLines={3}>{entry.description}</Text>

      <View style={styles.metaRow}>
        <Ionicons name="calendar-outline" size={14} color={palette.textSecondary} />
        <Text style={styles.metaText} numberOfLines={1}>{formatWindow(entry.window_start, entry.window_end)}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={14} color={palette.textSecondary} />
        <Text style={styles.metaText} numberOfLines={1}>
          {entry.delivery_label ?? entry.delivery_region ?? 'Location on request'}
        </Text>
      </View>

      {responded ? (
        <View style={styles.leadResponded}>
          <Ionicons name="checkmark-circle" size={14} color={palette.success} />
          <Text style={styles.leadRespondedText}>
            You {entry.my_response!.type === 'ACCEPT' ? 'accepted at' : 'quoted'} ZMW {entry.my_response!.price_zmw.toFixed(0)} — waiting on the customer
          </Text>
        </View>
      ) : (
        <View style={styles.leadActions}>
          {canAccept && (
            <Button
              mode="contained"
              compact
              onPress={onAccept}
              style={styles.leadAcceptBtn}
              contentStyle={{ paddingHorizontal: spacing.sm }}
            >
              Accept · ZMW {entry.service.base_price!.toFixed(0)}
            </Button>
          )}
          <Button
            mode="outlined"
            compact
            onPress={onQuote}
            style={styles.leadQuoteBtn}
            contentStyle={{ paddingHorizontal: spacing.sm }}
          >
            Send quote
          </Button>
        </View>
      )}
    </View>
  );
}

export default function IncomingRequestsScreen({ navigation }: any) {
  const [tab, setTab] = useState<TabKey>('new');
  const {
    incomingRequests, incomingLoading, incomingError,
    fetchIncomingRequests, clearIncomingError,
  } = useBookingStore();
  const { showError, showSuccess } = useSnackbar();
  const insets = useSafeAreaInsets();

  // v3.2 §6 — broadcast job leads (post-a-request feed)
  const [leads, setLeads]             = useState<ProviderRequestFeedEntry[]>([]);
  const [quoteTarget, setQuoteTarget] = useState<ProviderRequestFeedEntry | null>(null);
  const [quotePrice, setQuotePrice]   = useState('');
  const [responding, setResponding]   = useState(false);

  const fetchLeads = useCallback(() => {
    serviceRequestsApi.providerFeed().then(setLeads).catch(() => {});
  }, []);

  useEffect(() => {
    fetchIncomingRequests();
    fetchLeads();
  }, []);

  const respond = async (entry: ProviderRequestFeedEntry, type: 'ACCEPT' | 'QUOTE', priceZmw?: number) => {
    setResponding(true);
    try {
      await serviceRequestsApi.respond(entry.request_id, {
        type,
        ...(type === 'QUOTE' ? { price_zmw: priceZmw } : {}),
      });
      showSuccess(type === 'ACCEPT' ? 'Accepted — the customer has been notified.' : 'Quote sent.');
      setQuoteTarget(null);
      setQuotePrice('');
      fetchLeads();
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Could not send your response.');
    } finally {
      setResponding(false);
    }
  };

  useEffect(() => {
    if (incomingError) {
      showError(incomingError.message);
      clearIncomingError();
    }
  }, [incomingError]);

  // Platform payment mode — inferred from loaded entries (defaults to DIRECT, the pilot default).
  const platformMode: 'DIRECT' | 'ESCROW' =
    incomingRequests
      ? ([...incomingRequests.new, ...incomingRequests.scheduled][0]?.payment_mode ?? 'DIRECT')
      : 'DIRECT';
  const isDirect = platformMode === 'DIRECT';

  const Header = () => (
    <View style={styles.header}>
      <Text style={styles.title}>Requests</Text>
      <Text style={styles.subtitle}>
        {isDirect
          ? 'New booking requests waiting on you — accept, send a quote, or decline.'
          : 'Funded jobs waiting on you — accepted automatically once escrow is in place.'}
      </Text>
    </View>
  );

  if (incomingLoading && !incomingRequests) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header />
        <View style={styles.skeletons}>
          {[1, 2, 3].map((key) => <CardSkeleton key={key} style={styles.skeleton} />)}
        </View>
      </SafeAreaView>
    );
  }

  if (!incomingRequests) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header />
      </SafeAreaView>
    );
  }

  const { weekly, response_nudge, new: newRequests, scheduled } = incomingRequests;
  const weeklyProgress = weekly.weekly_cap_zmw ? Math.min(weekly.this_week_zmw / weekly.weekly_cap_zmw, 1) : 1;
  const isLeads = tab === 'leads';
  const list = tab === 'new' ? newRequests : tab === 'scheduled' ? scheduled : [];

  return (
    <SafeAreaView style={styles.safe}>
      <Header />
      <FlatList
        data={isLeads ? (leads as unknown as IncomingRequestEntry[]) : list}
        keyExtractor={(item: any) => isLeads ? item.request_id : item.booking_id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 120 }]}
        ListHeaderComponent={(
          <View style={styles.listHeader}>
            {/* Weekly earnings vs cap */}
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionLabel}>This week's earnings</Text>
                <Text style={styles.weeklyValue}>ZMW {weekly.this_week_zmw.toFixed(0)}</Text>
              </View>
              {weekly.weekly_cap_zmw != null ? (
                <>
                  <ProgressBar progress={weeklyProgress} color={weeklyProgress >= 1 ? palette.warning : palette.success} style={styles.bar} />
                  <Text style={styles.cardBody}>of your ZMW {weekly.weekly_cap_zmw} weekly cap</Text>
                </>
              ) : (
                <Text style={styles.cardBody}>No weekly cap at your tier.</Text>
              )}
            </View>

            {/* "Reply within 30 min" nudge — ties to response_rate_7d / Quick Responder badge */}
            {response_nudge.show && (
              <View style={styles.nudge}>
                <Ionicons name="flash-outline" size={18} color={palette.warning} />
                <Text style={styles.nudgeText}>
                  Reply within 30 minutes to keep your response rate up — it feeds the Quick Responder badge.
                </Text>
              </View>
            )}

            {/* New / Scheduled / Job leads tabs */}
            <SegmentedButtons
              value={tab}
              onValueChange={(v) => setTab(v as TabKey)}
              buttons={[
                { value: 'new',       label: `New (${newRequests.length})` },
                { value: 'scheduled', label: `Scheduled (${scheduled.length})` },
                { value: 'leads',     label: `Leads (${leads.length})` },
              ]}
              style={styles.segmented}
            />
          </View>
        )}
        renderItem={({ item }) => isLeads ? (
          <LeadCard
            entry={item as unknown as ProviderRequestFeedEntry}
            onAccept={() => respond(item as unknown as ProviderRequestFeedEntry, 'ACCEPT')}
            onQuote={() => {
              const lead = item as unknown as ProviderRequestFeedEntry;
              setQuoteTarget(lead);
              setQuotePrice(lead.budget_zmw != null ? String(lead.budget_zmw) : '');
            }}
          />
        ) : (
          <RequestCard
            entry={item}
            onPress={() => navigation.navigate('BookingDetail', { bookingId: item.booking_id })}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Ionicons
              name={tab === 'new' ? 'mail-open-outline' : tab === 'scheduled' ? 'calendar-outline' : 'megaphone-outline'}
              size={40}
              color={palette.textDisabled}
            />
            <Text style={styles.emptyTitle}>
              {tab === 'new' ? 'No new requests' : tab === 'scheduled' ? 'Nothing scheduled' : 'No job leads right now'}
            </Text>
            <Text style={styles.emptyBody}>
              {tab === 'new'
                ? (isDirect
                    ? 'New booking requests waiting for your response will land here.'
                    : 'Funded bookings waiting for you to start will land here.')
                : tab === 'scheduled'
                  ? (isDirect
                      ? 'Bookings you’ve accepted or started will show up here until they’re completed.'
                      : 'Jobs you’ve started will show up here until they’re delivered.')
                  : 'When a customer posts a request that matches your services and area, it lands here — reply within 30 minutes to win the job.'}
            </Text>
          </View>
        )}
        ListFooterComponent={(
          <Text style={styles.footnote}>
            For your safety and the buyer’s privacy, full contact details unlock once a job is under way —
            we never show a customer’s raw risk score, only the hint above.
          </Text>
        )}
      />

      {/* Quote dialog — §5.5 QUOTE semantics on a broadcast lead */}
      <Portal>
        <Dialog visible={quoteTarget != null} onDismiss={() => setQuoteTarget(null)}>
          <Dialog.Title>Send a quote</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.quoteDialogHint} numberOfLines={2}>
              {quoteTarget?.description}
            </Text>
            <TextInput
              mode="outlined"
              keyboardType="numeric"
              value={quotePrice}
              onChangeText={(t) => setQuotePrice(t.replace(/[^0-9.]/g, ''))}
              left={<TextInput.Affix text="ZMW" />}
              placeholder="Your price"
              autoFocus
            />
            {quoteTarget?.budget_zmw != null && (
              <Text style={styles.quoteDialogBudget}>Customer budget: ZMW {quoteTarget.budget_zmw.toFixed(0)}</Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setQuoteTarget(null)}>Cancel</Button>
            <Button
              mode="contained"
              loading={responding}
              disabled={responding || quotePrice.trim() === '' || Number(quotePrice) <= 0}
              onPress={() => quoteTarget && respond(quoteTarget, 'QUOTE', Number(quotePrice))}
            >
              Send quote
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm, gap: 2 },
  title: { ...typography.heading2, color: palette.textPrimary },
  subtitle: { ...typography.bodySmall, color: palette.textSecondary },

  skeletons: { padding: spacing.lg, gap: spacing.md },
  skeleton: { height: 130, borderRadius: r.xl },

  list: { paddingHorizontal: spacing.lg },
  listHeader: { gap: spacing.md, paddingBottom: spacing.sm },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.xl,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    ...shadow.card,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  // ── Job leads (v3.2 §6) ──────────────────────────────────────
  leadBudget:        { ...typography.bodySmall, color: palette.success, fontSize: 12, marginTop: 2 },
  leadDescription:   { ...typography.body, color: palette.textPrimary, fontSize: 13, lineHeight: 19, marginVertical: spacing.xs },
  leadActions:       { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  leadAcceptBtn:     { borderRadius: r.full, flexShrink: 1 },
  leadQuoteBtn:      { borderRadius: r.full },
  leadResponded:     { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  leadRespondedText: { ...typography.bodySmall, color: palette.success, fontSize: 12, flex: 1 },
  quoteDialogHint:   { ...typography.bodySmall, color: palette.textSecondary, marginBottom: spacing.sm },
  quoteDialogBudget: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12, marginTop: spacing.xs },
  sectionLabel: { ...typography.label, color: palette.textSecondary },
  cardBody: { ...typography.bodySmall, color: palette.textSecondary, marginTop: 2 },
  weeklyValue: { ...typography.heading3, color: palette.primary },
  bar: { height: 6, borderRadius: 3, marginVertical: spacing.sm },

  nudge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: palette.warningLight, borderRadius: r.lg,
    padding: spacing.md,
  },
  nudgeText: { ...typography.bodySmall, color: palette.warning, flex: 1, lineHeight: 18 },

  segmented: {},

  // Request cards
  cardWrap: { borderRadius: r.xl },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  avatar: {
    width: 38, height: 38, borderRadius: r.full,
    backgroundColor: palette.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  buyerName: { ...typography.label, color: palette.textPrimary, fontSize: 14 },
  hintPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    borderRadius: r.full, paddingHorizontal: spacing.xs, paddingVertical: 2, marginTop: 3,
  },
  hintText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10.5 },
  timerPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  timerText: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 11 },

  serviceTitle: { ...typography.label, color: palette.textPrimary, fontSize: 15, marginBottom: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metaText: { ...typography.bodySmall, color: palette.textSecondary, flex: 1 },

  netRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  netText: { ...typography.bodySmall, color: palette.textSecondary, flex: 1 },
  netStrong: { fontFamily: 'PlusJakartaSans_700Bold', color: palette.success },
  quoteChip: { backgroundColor: palette.primaryLight, height: 24 },
  quoteChipText: { fontSize: 10, color: palette.primary, marginVertical: 0, lineHeight: 14 },

  escrowRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm,
    paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: palette.border,
  },
  escrowText: { ...typography.bodySmall, color: palette.success, fontSize: 12, flex: 1 },

  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.xs },
  emptyTitle: { ...typography.label, color: palette.textPrimary },
  emptyBody: { ...typography.bodySmall, color: palette.textSecondary, textAlign: 'center', paddingHorizontal: spacing.xl },

  footnote: {
    ...typography.bodySmall, color: palette.textDisabled, fontSize: 11.5,
    textAlign: 'center', lineHeight: 16, marginTop: spacing.lg, paddingHorizontal: spacing.md,
  },
});
