import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import { Booking } from '../../api/bookings';
import { palette, radius as r, spacing, typography } from '../../theme';

/**
 * SCREEN 3 — the live, mutually-visible job timer (HOURLY_CAPPED especially).
 *
 * ONE record, TWO projections: the provider drives it ("Need more time",
 * "Finish"); the customer watches the identical figures read-only. The elapsed
 * time is derived from the SERVER's `job_started_at` (minus any paused spans) —
 * the same arithmetic the backend bills with — never a client-only clock. The
 * running "earning so far" is a live ESTIMATE of that formula; the FINAL charge
 * is computed server-side at Finish and can never exceed the approved cap.
 */

interface Elapsed {
  ms: number;
  paused: boolean;
}

/** Server-mirroring observed elapsed: wall-clock minus paused spans. */
function observedElapsed(booking: Booking, nowMs: number): Elapsed {
  if (!booking.job_started_at) return { ms: 0, paused: false };
  const start = Date.parse(booking.job_started_at);
  let elapsed = nowMs - start;
  let paused = false;
  for (const span of booking.pause_events ?? []) {
    if (!span.paused_at) continue;
    const pausedAt = Date.parse(span.paused_at);
    const resumedAt = span.resumed_at ? Date.parse(span.resumed_at) : nowMs;
    elapsed -= Math.max(0, resumedAt - pausedAt);
    if (!span.resumed_at) paused = true;
  }
  return { ms: Math.max(0, elapsed), paused };
}

function fmtClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZM', { hour: '2-digit', minute: '2-digit' });
}

export function JobTimerCard({
  booking,
  role,
  busy,
  firstName,
  onNeedMoreTime,
  onFinish,
  onApproveExtension,
}: {
  booking: Booking;
  role: 'provider' | 'customer';
  busy: boolean;
  /** Other party's first name, for the mutual-visibility line. */
  firstName: string;
  onNeedMoreTime?: () => void;
  onFinish?: () => void;
  /** Customer only — re-authorise a higher hold for `hours` extra time. */
  onApproveExtension?: (hours: number) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const elapsed = observedElapsed(booking, now);
  // Only HOURLY_CAPPED records a server start timestamp; other models run an
  // in-progress state with no observed clock (the start/finish events still
  // drive the lifecycle).
  const hasClock = !!booking.job_started_at;

  // Tick every second while running (freeze while paused — no wasted renders).
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!hasClock || elapsed.paused) {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      return;
    }
    timer.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [hasClock, elapsed.paused]);

  const isHourly = booking.service.pricing_model === 'HOURLY_CAPPED';
  const rate = booking.service.hourly_rate ?? 0;
  const cap = booking.approved_cap_zmw ?? booking.amount ?? 0;
  const warnRatio = booking.cap_warn_ratio ?? 0.8;

  // Live estimate of the server formula: rate × observed hours, capped. Rounded
  // up to the billing increment for the "billed-so-far" figure, so the preview
  // reads the way the final settlement will.
  const elapsedMins = elapsed.ms / 60000;
  const roundingMins = booking.hourly_rounding_mins ?? 30; // from server config
  const billedMins = Math.ceil(elapsedMins / roundingMins) * roundingMins;
  const rawEarning = (billedMins / 60) * rate;
  const earning = cap > 0 ? Math.min(rawEarning, cap) : rawEarning;
  const capRatio = cap > 0 ? Math.min(earning / cap, 1) : 0;
  const nearCap = isHourly && cap > 0 && earning / cap >= warnRatio;
  const atCap = isHourly && cap > 0 && earning >= cap;

  const extensionPending = !!booking.cap_extension_requested_at;

  const elapsedLabel =
    elapsedMins >= 60
      ? `${Math.floor(elapsedMins / 60)} hr ${Math.round(elapsedMins % 60)} min`
      : `${Math.round(elapsedMins)} min`;

  return (
    <View style={[styles.card, nearCap && styles.cardWarn]}>
      {hasClock ? (
        <>
          {/* Elapsed clock */}
          <View style={styles.clockRow}>
            <View style={[styles.pulse, elapsed.paused && styles.pulsePaused]} />
            <Text style={styles.clock}>{fmtClock(elapsed.ms)}</Text>
            {elapsed.paused && <Text style={styles.pausedTag}>Paused</Text>}
          </View>
          <Text style={styles.startedLine}>
            Started {fmtTime(booking.job_started_at!)} · {elapsedLabel} so far
          </Text>
        </>
      ) : (
        <View style={styles.clockRow}>
          <View style={styles.pulse} />
          <Text style={styles.inProgressTitle}>Job in progress</Text>
        </View>
      )}

      {/* The property that makes observed time honest. */}
      <View style={styles.mutualRow}>
        <Ionicons name="eye-outline" size={15} color={palette.primary} />
        <Text style={styles.mutualText}>
          {role === 'provider'
            ? `${firstName} can see this timer too`
            : `You're watching ${firstName}'s timer live`}
        </Text>
      </View>

      {isHourly && rate > 0 && (
        <>
          <View style={styles.divider} />

          {/* Running figures */}
          <View style={styles.figRow}>
            <Text style={styles.figLabel}>Rate</Text>
            <Text style={styles.figValue}>ZMW {rate.toFixed(0)}/hr</Text>
          </View>
          <View style={styles.figRow}>
            <Text style={styles.figLabel}>{role === 'provider' ? 'Earning so far' : 'Charge so far'}</Text>
            <Text style={styles.figValue}>≈ ZMW {earning.toFixed(2)}</Text>
          </View>

          {/* Progress toward the approved cap */}
          <View style={styles.capBarTrack}>
            <View
              style={[
                styles.capBarFill,
                { width: `${Math.round(capRatio * 100)}%` },
                nearCap && styles.capBarFillWarn,
              ]}
            />
          </View>
          <View style={styles.capLabelRow}>
            <Text style={styles.capHint}>
              {role === 'customer' ? 'You only pay for the time actually worked' : 'Billed only for time worked'}
            </Text>
            <Text style={styles.capValue}>Cap ZMW {cap.toFixed(0)}</Text>
          </View>

          {/* Cap-approach prompt — both parties see it; the cap is never
              silently exceeded. */}
          {(nearCap || atCap) && !extensionPending && (
            <View style={styles.warnBox}>
              <Ionicons name="alert-circle-outline" size={16} color={palette.warning} />
              <Text style={styles.warnText}>
                {atCap
                  ? 'The job has reached the approved cap. More time needs the customer to authorise a higher amount.'
                  : 'Approaching the approved cap.'}
              </Text>
            </View>
          )}

          {/* Provider is waiting on the customer to approve more time. */}
          {extensionPending && role === 'provider' && (
            <View style={styles.warnBox}>
              <Ionicons name="hourglass-outline" size={16} color={palette.warning} />
              <Text style={styles.warnText}>Waiting for {firstName} to approve more time…</Text>
            </View>
          )}

          {/* Customer approves a higher hold (re-authorisation via Lipila). */}
          {extensionPending && role === 'customer' && onApproveExtension && (
            <View style={styles.extendBox}>
              <Text style={styles.extendTitle}>{firstName} needs more time</Text>
              <Text style={styles.extendSub}>
                Authorise extra time — we'll hold the additional amount, and you're still only charged for time worked.
              </Text>
              <View style={styles.extendChips}>
                {[0.5, 1, 2].map((h) => (
                  <TouchableRipple
                    key={h}
                    borderless
                    disabled={busy}
                    style={styles.extendChip}
                    onPress={() => onApproveExtension(h)}
                    accessibilityRole="button"
                    accessibilityLabel={`Approve ${h} more hours, hold ZMW ${(h * rate).toFixed(0)}`}
                  >
                    <Text style={styles.extendChipText}>
                      +{h < 1 ? `${h * 60} min` : `${h} hr`} · ZMW {(h * rate).toFixed(0)}
                    </Text>
                  </TouchableRipple>
                ))}
              </View>
            </View>
          )}
        </>
      )}

      {/* Provider actions */}
      {role === 'provider' && (
        <View style={styles.actions}>
          {isHourly && onNeedMoreTime && !extensionPending && (
            <Button
              mode="outlined"
              style={styles.needMoreBtn}
              contentStyle={styles.btnContent}
              textColor={palette.primary}
              icon="timer-plus-outline"
              disabled={busy}
              onPress={onNeedMoreTime}
            >
              Need more time
            </Button>
          )}
          {onFinish && (
            <Button
              mode="contained"
              style={styles.finishBtn}
              contentStyle={styles.btnContent}
              labelStyle={styles.finishLabel}
              loading={busy}
              disabled={busy}
              onPress={onFinish}
            >
              Finish job
            </Button>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: r.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardWarn: { borderColor: palette.warning },

  clockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pulse: { width: 10, height: 10, borderRadius: r.full, backgroundColor: palette.danger },
  pulsePaused: { backgroundColor: palette.textDisabled },
  clock: { ...typography.heading2, color: palette.textPrimary, fontSize: 40, fontVariant: ['tabular-nums'] },
  pausedTag: {
    ...typography.label, color: palette.textSecondary, fontSize: 12,
    backgroundColor: palette.background, borderRadius: r.sm, paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  startedLine: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 13 },
  inProgressTitle: { ...typography.heading3, color: palette.textPrimary, fontSize: 18 },

  mutualRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  mutualText: { ...typography.bodySmall, color: palette.primary, fontSize: 13, flex: 1 },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.sm },

  figRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  figLabel: { ...typography.body, color: palette.textSecondary, fontSize: 15 },
  figValue: { ...typography.body, color: palette.textPrimary, fontSize: 15, fontFamily: 'DMSans_500Medium' },

  capBarTrack: {
    height: 8, borderRadius: r.full, backgroundColor: palette.background,
    overflow: 'hidden', marginTop: spacing.sm,
  },
  capBarFill: { height: '100%', borderRadius: r.full, backgroundColor: palette.primary },
  capBarFillWarn: { backgroundColor: palette.warning },
  capLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
  capHint: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12, flex: 1 },
  capValue: { ...typography.label, color: palette.textPrimary, fontSize: 13 },

  warnBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    backgroundColor: palette.warningLight, borderRadius: r.sm, padding: spacing.sm, marginTop: spacing.sm,
  },
  warnText: { ...typography.bodySmall, color: palette.warning, fontSize: 13, flex: 1 },

  extendBox: {
    backgroundColor: palette.primaryLight, borderRadius: r.sm, padding: spacing.md, marginTop: spacing.sm, gap: spacing.xs,
  },
  extendTitle: { ...typography.label, color: palette.primary, fontSize: 14 },
  extendSub: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 13 },
  extendChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  extendChip: {
    borderWidth: 1, borderColor: palette.primary, borderRadius: r.full,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: palette.surface,
  },
  extendChipText: { ...typography.label, color: palette.primary, fontSize: 13 },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  needMoreBtn: { flex: 1, borderRadius: r.sm, borderColor: palette.primary },
  finishBtn: { flex: 1, borderRadius: r.sm },
  btnContent: { height: 48 },
  finishLabel: { ...typography.label, fontSize: 15 },
});
