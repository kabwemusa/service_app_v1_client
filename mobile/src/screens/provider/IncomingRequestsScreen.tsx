import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, useColorScheme, View } from 'react-native';
import { Button, Dialog, Portal, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { IncomingRequestEntry, TrustHint } from '../../api/bookings';
import { ApiError } from '../../api/errors';
import { ProviderRequestFeedEntry, serviceRequestsApi } from '../../api/serviceRequests';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useBookingStore } from '../../store/bookingStore';
import { palette, radius as r, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type TabKey = 'new' | 'scheduled' | 'leads';

// ── Theme (dark/light, AA) ──────────────────────────────────────────────────
type ThemeC = { bg: string; surface: string; border: string; t1: string; t2: string; t3: string };
const DARK:  ThemeC = { bg: '#0F0A0D', surface: '#1C1015', border: '#3A2030', t1: '#F5E8EE', t2: '#C79BB0', t3: '#7C5868' };
const LIGHT: ThemeC = { bg: palette.background, surface: palette.surface, border: palette.border, t1: palette.textPrimary, t2: palette.textSecondary, t3: palette.textDisabled };

// §10.2 — discreet, qualitative trust hint. "New customer" is deliberately neutral
// (never a warning colour): risky buyers are filtered server-side, so a warning
// tint here would only bias providers. NEVER a numeric score.
const TRUST_HINT_META: Record<TrustHint, { label: string; icon: IconName; color: string; bg: string }> = {
  REPEAT_CLIENT: { label: 'Repeat client',    icon: 'repeat-outline',           color: palette.success,       bg: palette.successLight },
  TRUSTED:       { label: 'Trusted customer', icon: 'shield-checkmark-outline', color: palette.success,       bg: palette.successLight },
  NEW:           { label: 'New customer',     icon: 'person-outline',           color: palette.textSecondary, bg: palette.primaryLight },
};

function initials(name?: string | null): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function formatScheduled(iso: string | null): string {
  if (!iso) return 'Time to be confirmed';
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// Soft 30-min "fast reply" window that feeds the Quick Responder badge (§9.2).
// Not the hard EXPIRED deadline (that's the server response window) — a nudge timer.
function replyTimer(createdAt: string | null): { text: string; warn: boolean } | null {
  if (!createdAt) return null;
  const remaining = 30 * 60_000 - (Date.now() - new Date(createdAt).getTime());
  if (remaining > 0) {
    const m = Math.ceil(remaining / 60_000);
    return { text: `${m}m to reply`, warn: remaining <= 10 * 60_000 };
  }
  return { text: 'Reply now', warn: true };
}

function deadlineLabel(respondBy: string): { text: string; expired: boolean } {
  const diff = new Date(respondBy).getTime() - Date.now();
  if (diff <= 0) return { text: 'Deadline passed', expired: true };
  const m = Math.ceil(diff / 60_000);
  return { text: m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m to reply` : `${m}m to reply`, expired: false };
}

function formatWindow(startIso: string, endIso: string): string {
  const start = new Date(startIso), end = new Date(endIso);
  const day  = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time(start)}–${time(end)}`;
}

// ── Trust pill ───────────────────────────────────────────────────────────────
function TrustPill({ hint }: { hint: TrustHint }) {
  const m = TRUST_HINT_META[hint];
  return (
    <View style={[styles.hintPill, { backgroundColor: m.bg }]}>
      <Ionicons name={m.icon} size={11} color={m.color} />
      <Text style={[styles.hintText, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

// ── Request card (New + Scheduled) ───────────────────────────────────────────
function RequestCard({ entry, scheduled, c, busy, onAccept, onDecline, onQuote, onMessage, onView }: {
  entry: IncomingRequestEntry;
  scheduled: boolean;
  c: ThemeC;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onQuote: () => void;
  onMessage: () => void;
  onView: () => void;
}) {
  const isDirect = entry.payment_mode === 'DIRECT';
  // Awaiting a quote (provider must respond) vs already quoted (waiting on buyer).
  const quoteFirst = entry.pricing_model === 'PROVIDER_SCOPE' || entry.pricing_model === 'QUOTE_DEPOSIT';
  const needsQuote = entry.status === 'SCOPE_PENDING' || (quoteFirst && entry.status === 'REQUESTED');
  const quoteSent  = entry.status === 'QUOTED' || entry.status === 'QUOTE_SENT';
  const locationLabel = entry.delivery_label ?? entry.delivery_region ?? 'Location on file';
  const timer = scheduled || quoteSent ? null : replyTimer(entry.created_at);

  // Payment line — payment_mode-aware (one source of truth), full amount in DIRECT.
  let paymentLine: React.ReactNode;
  if (isDirect) {
    if (needsQuote) {
      paymentLine = <Text style={[styles.payText, { color: c.t2 }]}>Price by quote · <Text style={styles.payStrong}>paid directly</Text></Text>;
    } else if (quoteSent) {
      paymentLine = <Text style={[styles.payText, { color: c.t2 }]}>Quoted <Text style={styles.payStrong}>ZMW {entry.gross_zmw.toFixed(0)}</Text> · paid directly</Text>;
    } else if (scheduled) {
      paymentLine = <Text style={[styles.payText, { color: c.t2 }]}>Collect <Text style={styles.payStrong}>ZMW {entry.gross_zmw.toFixed(0)}</Text> on completion</Text>;
    } else {
      paymentLine = <Text style={[styles.payText, { color: c.t2 }]}>You'll be paid <Text style={styles.payStrong}>ZMW {entry.gross_zmw.toFixed(0)}</Text> directly</Text>;
    }
  } else {
    paymentLine = (
      <Text style={[styles.payText, { color: c.t2 }]}>
        You keep <Text style={styles.payStrong}>ZMW {entry.net_zmw.toFixed(0)}</Text> · {scheduled ? 'released on completion' : 'funds held in escrow'}
      </Text>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {/* ── Job details ── */}
      <View style={styles.cardTop}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(entry.buyer_label)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.buyerName, { color: c.t1 }]} numberOfLines={1}>{entry.buyer_label}</Text>
          <TrustPill hint={entry.trust_hint} />
        </View>
        {timer && (
          <View style={[styles.timerPill, { backgroundColor: timer.warn ? palette.warningLight : c.border }]}
            accessibilityLabel={timer.warn ? `Reply soon: ${timer.text}` : timer.text}>
            <Ionicons name="time-outline" size={12} color={timer.warn ? palette.warning : c.t2} />
            <Text style={[styles.timerText, { color: timer.warn ? palette.warning : c.t2 }]}>{timer.text}</Text>
          </View>
        )}
      </View>

      <Text style={[styles.serviceTitle, { color: c.t1 }]} numberOfLines={1}>{entry.service_title ?? 'Service'}</Text>
      <View style={styles.metaRow}>
        <Ionicons name="calendar-outline" size={14} color={c.t2} />
        <Text style={[styles.metaText, { color: c.t2 }]} numberOfLines={1}>{formatScheduled(entry.scheduled_start)}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={14} color={c.t2} />
        <Text style={[styles.metaText, { color: c.t2 }]} numberOfLines={1}>
          {locationLabel}{entry.distance_km != null ? ` · ${entry.distance_km} km away` : ''}
        </Text>
      </View>

      {/* ── Divider separating details from money + actions ── */}
      <View style={[styles.cardDivider, { backgroundColor: c.border }]} />

      {/* ── Money + actions ── */}
      {paymentLine}
      {scheduled ? (
        <View style={styles.actionRow}>
          <Button mode="outlined" onPress={onMessage} style={[styles.btn, styles.btnGhost, { borderColor: c.border }]}
            contentStyle={styles.btnContent} textColor={c.t1} accessibilityLabel="Message customer">Message</Button>
          <Button mode="contained" onPress={onView} style={styles.btn} contentStyle={styles.btnContent}
            labelStyle={styles.btnLabel} accessibilityLabel="View booking">View</Button>
        </View>
      ) : quoteSent ? (
        <View style={styles.passive}>
          <Ionicons name="hourglass-outline" size={15} color={c.t2} />
          <Text style={[styles.passiveText, { color: c.t2 }]}>Quote sent · waiting for the customer to accept</Text>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <Button mode="outlined" onPress={onDecline} disabled={busy} style={[styles.btn, { borderColor: palette.danger }]}
            contentStyle={styles.btnContent} textColor={palette.danger} accessibilityLabel="Decline request">Decline</Button>
          {needsQuote ? (
            <Button mode="contained" onPress={onQuote} disabled={busy} style={styles.btn} contentStyle={styles.btnContent}
              labelStyle={styles.btnLabel} accessibilityLabel="Send a quote">Send quote</Button>
          ) : (
            <Button mode="contained" onPress={onAccept} loading={busy} disabled={busy} style={styles.btn}
              contentStyle={styles.btnContent} labelStyle={styles.btnLabel} accessibilityLabel={`Accept for ZMW ${entry.gross_zmw.toFixed(0)}`}>
              Accept · ZMW {entry.gross_zmw.toFixed(0)}
            </Button>
          )}
        </View>
      )}
    </View>
  );
}

// ── Broadcast job lead (v3.2 §6) ─────────────────────────────────────────────
function LeadCard({ entry, c, onAccept, onQuote }: { entry: ProviderRequestFeedEntry; c: ThemeC; onAccept: () => void; onQuote: () => void }) {
  const deadline  = deadlineLabel(entry.respond_by);
  const responded = entry.my_response != null;
  const canAccept = entry.service.base_price != null
    && entry.service.pricing_model !== 'PROVIDER_SCOPE'
    && entry.service.pricing_model !== 'QUOTE_DEPOSIT';

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.cardTop}>
        <View style={[styles.avatar, { backgroundColor: palette.warningLight }]}>
          <Ionicons name="megaphone-outline" size={16} color={palette.warning} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.buyerName, { color: c.t1 }]} numberOfLines={1}>{entry.category_name} request</Text>
          {entry.budget_zmw != null && <Text style={styles.leadBudget}>Budget ZMW {entry.budget_zmw.toFixed(0)}</Text>}
        </View>
        {!responded && (
          <View style={[styles.timerPill, { backgroundColor: deadline.expired ? c.border : palette.warningLight }]}>
            <Ionicons name="time-outline" size={12} color={deadline.expired ? c.t3 : palette.warning} />
            <Text style={[styles.timerText, { color: deadline.expired ? c.t3 : palette.warning }]}>{deadline.text}</Text>
          </View>
        )}
      </View>

      <Text style={[styles.leadDescription, { color: c.t1 }]} numberOfLines={3}>{entry.description}</Text>
      <View style={styles.metaRow}>
        <Ionicons name="calendar-outline" size={14} color={c.t2} />
        <Text style={[styles.metaText, { color: c.t2 }]} numberOfLines={1}>{formatWindow(entry.window_start, entry.window_end)}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={14} color={c.t2} />
        <Text style={[styles.metaText, { color: c.t2 }]} numberOfLines={1}>{entry.delivery_label ?? entry.delivery_region ?? 'Location on request'}</Text>
      </View>

      <View style={[styles.cardDivider, { backgroundColor: c.border }]} />

      {responded ? (
        <View style={styles.leadResponded}>
          <Ionicons name="checkmark-circle" size={14} color={palette.success} />
          <Text style={styles.leadRespondedText}>
            You {entry.my_response!.type === 'ACCEPT' ? 'accepted at' : 'quoted'} ZMW {entry.my_response!.price_zmw.toFixed(0)} — waiting on the customer
          </Text>
        </View>
      ) : (
        <View style={styles.actionRow}>
          {canAccept && (
            <Button mode="contained" onPress={onAccept} style={styles.btn} contentStyle={styles.btnContent} labelStyle={styles.btnLabel}>
              Accept · ZMW {entry.service.base_price!.toFixed(0)}
            </Button>
          )}
          <Button mode="outlined" onPress={onQuote} style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} contentStyle={styles.btnContent} textColor={c.t1}>
            Send quote
          </Button>
        </View>
      )}
    </View>
  );
}

// ── Themed tab bar ───────────────────────────────────────────────────────────
function TabBar({ c, active, onChange, counts }: {
  c: ThemeC; active: TabKey; onChange: (k: TabKey) => void; counts: Record<TabKey, number>;
}) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'new',       label: 'New' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'leads',     label: 'Leads' },
  ];
  return (
    <View style={[styles.tabBar, { borderBottomColor: c.border }]} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.key === active;
        const label = `${t.label} (${counts[t.key]})`;
        return (
          <TouchableRipple key={t.key} onPress={() => onChange(t.key)} borderless
            accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label} style={styles.tabTap}>
            <View style={[styles.tab, on && { borderBottomColor: palette.primary }]}>
              <Text style={[styles.tabText, { color: on ? palette.primary : c.t2 }, on && styles.tabTextActive]} numberOfLines={1}>{label}</Text>
            </View>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

export default function IncomingRequestsScreen({ navigation }: any) {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? DARK : LIGHT;
  const insets = useSafeAreaInsets();
  const { showError, showSuccess } = useSnackbar();

  const {
    incomingRequests, incomingLoading, incomingError, fetchIncomingRequests, clearIncomingError,
    accept, decline, quote, submitting,
  } = useBookingStore();

  const [tab, setTab] = useState<TabKey>('new');
  const [, setTick] = useState(0); // 30s ticker so reply timers stay current
  const [actingId, setActingId] = useState<string | null>(null);

  // Broadcast leads (v3.2 §6)
  const [leads, setLeads] = useState<ProviderRequestFeedEntry[]>([]);
  const [leadQuote, setLeadQuote] = useState<ProviderRequestFeedEntry | null>(null);
  // Booking quote (DIRECT QUOTE request)
  const [bookingQuote, setBookingQuote] = useState<IncomingRequestEntry | null>(null);
  const [quotePrice, setQuotePrice] = useState('');
  const [responding, setResponding] = useState(false);

  const fetchLeads = useCallback(() => { serviceRequestsApi.providerFeed().then(setLeads).catch(() => {}); }, []);

  useEffect(() => { fetchIncomingRequests(); fetchLeads(); }, []);
  useEffect(() => { const i = setInterval(() => setTick((t) => t + 1), 30_000); return () => clearInterval(i); }, []);
  useEffect(() => { if (incomingError) { showError(incomingError.message); clearIncomingError(); } }, [incomingError]);

  // Booking transition via the state machine, then refresh both lists.
  const runTransition = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setActingId(id);
    try {
      await fn();
      showSuccess(ok);
      await fetchIncomingRequests();
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Could not complete that action.');
    } finally {
      setActingId(null);
    }
  };

  const confirmAccept = (e: IncomingRequestEntry) => Alert.alert(
    'Accept request',
    `Accept this booking at ZMW ${e.gross_zmw.toFixed(0)}? This confirms the job — the customer pays you directly.`,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Accept', onPress: () => runTransition(e.booking_id, () => accept(e.booking_id), 'Accepted — the customer has been notified.') }],
  );
  const confirmDecline = (e: IncomingRequestEntry) => Alert.alert(
    'Decline request',
    'Decline this booking? The customer will be notified and this cannot be undone.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Decline', style: 'destructive', onPress: () => runTransition(e.booking_id, () => decline(e.booking_id), 'Request declined.') }],
  );

  const submitBookingQuote = async () => {
    if (!bookingQuote) return;
    const price = Number(quotePrice);
    if (!(price > 0)) { showError('Enter a valid amount above ZMW 0.'); return; }
    setBookingQuote(null);
    setQuotePrice('');
    await runTransition(bookingQuote.booking_id, () => quote(bookingQuote.booking_id, price), 'Quote sent to the customer.');
  };

  const respondLead = async (entry: ProviderRequestFeedEntry, type: 'ACCEPT' | 'QUOTE', priceZmw?: number) => {
    setResponding(true);
    try {
      await serviceRequestsApi.respond(entry.request_id, { type, ...(type === 'QUOTE' ? { price_zmw: priceZmw } : {}) });
      showSuccess(type === 'ACCEPT' ? 'Accepted — the customer has been notified.' : 'Quote sent.');
      setLeadQuote(null); setQuotePrice(''); fetchLeads();
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Could not send your response.');
    } finally {
      setResponding(false);
    }
  };

  // Platform payment mode — from loaded entries (DIRECT pilot default).
  const isDirect = (incomingRequests
    ? [...incomingRequests.new, ...incomingRequests.scheduled][0]?.payment_mode ?? 'DIRECT'
    : 'DIRECT') === 'DIRECT';

  const renderHeader = (counts: Record<TabKey, number>, showNudge: boolean) => (
    <>
      <ScreenHeader title="Requests" />
      <View style={[styles.pinned, { backgroundColor: c.bg, borderBottomColor: c.border }]}>
        {showNudge && (
          <View style={styles.nudge}>
            <Ionicons name="flash-outline" size={16} color={palette.warning} />
            <Text style={styles.nudgeText}>Reply within 30 min to keep your Quick Responder badge.</Text>
          </View>
        )}
        <TabBar c={c} active={tab} onChange={setTab} counts={counts} />
      </View>
    </>
  );

  // ── Loading ──
  if (incomingLoading && !incomingRequests) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
        {renderHeader({ new: 0, scheduled: 0, leads: leads.length }, false)}
        <View style={styles.skeletons}>{[1, 2, 3].map((k) => <CardSkeleton key={k} style={styles.skeleton} />)}</View>
      </SafeAreaView>
    );
  }
  if (!incomingRequests) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
        {renderHeader({ new: 0, scheduled: 0, leads: leads.length }, false)}
      </SafeAreaView>
    );
  }

  const { response_nudge, new: newRequests, scheduled } = incomingRequests;
  const counts: Record<TabKey, number> = { new: newRequests.length, scheduled: scheduled.length, leads: leads.length };
  const isLeads = tab === 'leads';
  const list = tab === 'new' ? newRequests : tab === 'scheduled' ? scheduled : [];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      {renderHeader(counts, response_nudge.show)}

      <FlatList
        data={isLeads ? (leads as any[]) : list}
        keyExtractor={(item: any) => isLeads ? item.request_id : item.booking_id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => isLeads ? (
          <LeadCard
            entry={item as ProviderRequestFeedEntry}
            c={c}
            onAccept={() => respondLead(item as ProviderRequestFeedEntry, 'ACCEPT')}
            onQuote={() => { const l = item as ProviderRequestFeedEntry; setLeadQuote(l); setQuotePrice(l.budget_zmw != null ? String(l.budget_zmw) : ''); }}
          />
        ) : (
          <RequestCard
            entry={item as IncomingRequestEntry}
            scheduled={tab === 'scheduled'}
            c={c}
            busy={actingId === (item as IncomingRequestEntry).booking_id || submitting}
            onAccept={() => confirmAccept(item as IncomingRequestEntry)}
            onDecline={() => confirmDecline(item as IncomingRequestEntry)}
            onQuote={() => { const e = item as IncomingRequestEntry; setBookingQuote(e); setQuotePrice(e.gross_zmw > 0 ? String(e.gross_zmw.toFixed(0)) : ''); }}
            onMessage={() => showSuccess("In-app messaging is coming soon.")}
            onView={() => navigation.navigate('BookingDetail', { bookingId: (item as IncomingRequestEntry).booking_id })}
          />
        )}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Ionicons name={tab === 'new' ? 'mail-open-outline' : tab === 'scheduled' ? 'calendar-outline' : 'megaphone-outline'} size={40} color={c.t3} />
            <Text style={[styles.emptyTitle, { color: c.t1 }]}>
              {tab === 'new' ? 'No new requests' : tab === 'scheduled' ? 'Nothing scheduled' : 'No job leads right now'}
            </Text>
            <Text style={[styles.emptyBody, { color: c.t2 }]}>
              {tab === 'new'
                ? (isDirect ? 'New booking requests waiting for your response will land here.' : 'Funded bookings waiting for you to start will land here.')
                : tab === 'scheduled'
                  ? 'Bookings you’ve accepted will show here until they’re completed.'
                  : 'When a customer posts a request matching your services and area, it lands here — reply fast to win the job.'}
            </Text>
          </View>
        )}
        ListFooterComponent={list.length > 0 || isLeads ? (
          <Text style={[styles.footnote, { color: c.t3 }]}>
            The customer hint is a guide, not a score — risky accounts are filtered before they reach you. We never show a raw risk score.
          </Text>
        ) : null}
      />

      {/* Quote dialogs */}
      <Portal>
        <Dialog visible={bookingQuote != null} onDismiss={() => setBookingQuote(null)}>
          <Dialog.Title>Send a quote</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.quoteHint} numberOfLines={2}>
              Propose your price for {bookingQuote?.service_title ?? 'this job'}. The customer pays you directly if they accept.
            </Text>
            <TextInput mode="outlined" keyboardType="numeric" value={quotePrice}
              onChangeText={(t) => setQuotePrice(t.replace(/[^0-9.]/g, ''))} left={<TextInput.Affix text="ZMW" />}
              placeholder="Your price" autoFocus />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setBookingQuote(null)}>Cancel</Button>
            <Button mode="contained" loading={actingId === bookingQuote?.booking_id}
              disabled={quotePrice.trim() === '' || Number(quotePrice) <= 0} onPress={submitBookingQuote}>Send quote</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={leadQuote != null} onDismiss={() => setLeadQuote(null)}>
          <Dialog.Title>Send a quote</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.quoteHint} numberOfLines={2}>{leadQuote?.description}</Text>
            <TextInput mode="outlined" keyboardType="numeric" value={quotePrice}
              onChangeText={(t) => setQuotePrice(t.replace(/[^0-9.]/g, ''))} left={<TextInput.Affix text="ZMW" />}
              placeholder="Your price" autoFocus />
            {leadQuote?.budget_zmw != null && <Text style={styles.quoteBudget}>Customer budget: ZMW {leadQuote.budget_zmw.toFixed(0)}</Text>}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setLeadQuote(null)}>Cancel</Button>
            <Button mode="contained" loading={responding} disabled={responding || quotePrice.trim() === '' || Number(quotePrice) <= 0}
              onPress={() => leadQuote && respondLead(leadQuote, 'QUOTE', Number(quotePrice))}>Send quote</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Pinned header (title + nudge + tabs)
  pinned: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.heading2, marginBottom: spacing.sm },
  nudge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: palette.warningLight, borderRadius: r.sm, padding: spacing.sm, marginBottom: spacing.sm,
  },
  nudgeText: { ...typography.bodySmall, color: palette.warning, flex: 1, fontSize: 13, lineHeight: 18 },

  // Tabs
  tabBar: { flexDirection: 'row' },
  tabTap: { flex: 1, borderRadius: r.sm },
  tab: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { ...typography.body, fontSize: 14 },
  tabTextActive: { fontFamily: 'DMSans_500Medium' },

  skeletons: { padding: spacing.lg, gap: spacing.md },
  skeleton: { height: 150, borderRadius: r.sm },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  // Card (flat, small radius, no shadow)
  card: { borderRadius: r.sm, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: r.full, backgroundColor: palette.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'DMSans_600SemiBold', fontSize: 14, color: palette.primary },
  buyerName: { ...typography.label, fontSize: 15 },
  hintPill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: r.sm, paddingHorizontal: spacing.xs, paddingVertical: 2, marginTop: 3 },
  hintText: { fontFamily: 'DMSans_500Medium', fontSize: 11 },
  timerPill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: r.sm, paddingHorizontal: spacing.xs, paddingVertical: 3 },
  timerText: { ...typography.bodySmall, fontSize: 11, fontFamily: 'DMSans_500Medium' },

  serviceTitle: { ...typography.label, fontSize: 16, marginBottom: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metaText: { ...typography.bodySmall, flex: 1 },

  cardDivider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.md },

  payText: { ...typography.body, fontSize: 14, marginBottom: spacing.sm },
  payStrong: { fontFamily: 'DMSans_700Bold', color: palette.success },

  passive: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  passiveText: { ...typography.bodySmall, flex: 1, fontSize: 13 },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1, borderRadius: r.sm },
  btnGhost: {},
  btnContent: { height: 44 },
  btnLabel: { ...typography.label, fontSize: 14 },

  // Leads
  leadBudget: { ...typography.bodySmall, color: palette.success, fontSize: 12, marginTop: 2 },
  leadDescription: { ...typography.body, fontSize: 14, lineHeight: 20, marginBottom: spacing.xs },
  leadResponded: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  leadRespondedText: { ...typography.bodySmall, color: palette.success, fontSize: 12, flex: 1 },

  // Empty + footnote
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.xs },
  emptyTitle: { ...typography.label, fontSize: 16 },
  emptyBody: { ...typography.bodySmall, textAlign: 'center', paddingHorizontal: spacing.xl, lineHeight: 19 },
  footnote: { ...typography.bodySmall, fontSize: 11.5, textAlign: 'center', lineHeight: 16, marginTop: spacing.lg, paddingHorizontal: spacing.md },

  // Quote dialog
  quoteHint: { ...typography.bodySmall, color: palette.textSecondary, marginBottom: spacing.sm },
  quoteBudget: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12, marginTop: spacing.xs },
});
