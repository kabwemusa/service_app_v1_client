import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  availabilityApi,
  AvailabilitySlot,
} from '../../api/availability';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { palette, radius as r, spacing, typography } from '../../theme';

/**
 * Weekly availability + time off.
 *
 * This is what makes a provider bookable: the hours saved here feed the
 * WhatsApp date-picker, the PWA date-picker and dispatch eligibility.
 * Days are shown MON→SUN; the API uses 0=Sunday…6=Saturday.
 */

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 0] as const; // API day_of_week per label

const HOURS = Array.from({ length: 17 }, (_, i) => {
  const h = i + 6; // 06:00 … 22:00
  return `${String(h).padStart(2, '0')}:00`;
});

type DayWindow = { start: string; end: string };
type WeekState = Partial<Record<number, DayWindow>>; // keyed by day_of_week

function scheduleToWeek(slots: AvailabilitySlot[]): WeekState {
  const week: WeekState = {};
  for (const s of slots) {
    // One window per day in this editor — first slot wins.
    if (!week[s.day_of_week]) {
      week[s.day_of_week] = { start: s.start_time, end: s.end_time };
    }
  }
  return week;
}

function weekToSchedule(week: WeekState): AvailabilitySlot[] {
  return Object.entries(week).map(([dow, w]) => ({
    day_of_week: Number(dow),
    start_time:  w!.start,
    end_time:    w!.end,
  }));
}

/** Next 30 days for the time-off strip. */
function upcomingDates(): { date: string; label: string; sub: string }[] {
  const out: { date: string; label: string; sub: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({
      date:  iso,
      label: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      sub:   d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    });
  }
  return out;
}

export default function AvailabilityScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { showSuccess, showError } = useSnackbar();

  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [week, setWeek]         = useState<WeekState>({});
  const [blocked, setBlocked]   = useState<string[]>([]);
  const [dirty, setDirty]       = useState(false);

  const dates = useMemo(upcomingDates, []);

  useEffect(() => {
    (async () => {
      try {
        const state = await availabilityApi.get();
        setWeek(scheduleToWeek(state.schedule));
        setBlocked(state.blocked_dates);
      } catch (e: any) {
        showError(e?.message ?? 'Could not load your availability.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleDay = (dow: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDirty(true);
    setWeek(prev => {
      if (prev[dow]) {
        const { [dow]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [dow]: { start: '08:00', end: '17:00' } };
    });
  };

  const setDayTime = (dow: number, field: 'start' | 'end', value: string) => {
    setDirty(true);
    setWeek(prev => ({ ...prev, [dow]: { ...prev[dow]!, [field]: value } }));
  };

  const handleSave = async () => {
    const slots = weekToSchedule(week);
    const invalid = slots.find(s => s.start_time >= s.end_time);
    if (invalid) {
      showError('Each day must end after it starts.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaving(true);
    try {
      const state = await availabilityApi.setSchedule(slots);
      setWeek(scheduleToWeek(state.schedule));
      setDirty(false);
      showSuccess(
        slots.length > 0
          ? 'Availability saved — customers can now book these hours.'
          : 'Availability cleared — you will not receive new bookings until you set hours.',
      );
    } catch (e: any) {
      showError(e?.message ?? 'Could not save your availability.');
    } finally {
      setSaving(false);
    }
  };

  const toggleBlocked = async (date: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const isBlocked = blocked.includes(date);
    // Optimistic flip; reconcile with the server response.
    setBlocked(prev => (isBlocked ? prev.filter(d => d !== date) : [...prev, date]));
    try {
      const res = isBlocked
        ? await availabilityApi.unblockDate(date)
        : await availabilityApi.blockDate(date);
      setBlocked(res.blocked_dates);
    } catch (e: any) {
      setBlocked(prev => (isBlocked ? [...prev, date] : prev.filter(d => d !== date)));
      showError(e?.message ?? 'Could not update that date.');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScreenHeader title="Availability" back onBack={() => navigation.goBack()} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const activeDays = Object.keys(week).length;

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader
        title="Availability"
        subtitle="Customers can only book the hours you set here"
        back
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 96 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>Weekly hours</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>
            Pick the days you work, then set your hours. Bookings on WhatsApp and the
            app only offer times inside these windows.
          </Text>

          {DAY_LABELS.map((label, i) => {
            const dow = DAY_NUMBERS[i];
            const window = week[dow];
            const active = !!window;
            return (
              <View key={label} style={styles.dayRow}>
                <TouchableRipple
                  borderless
                  onPress={() => toggleDay(dow)}
                  style={[styles.dayChip, active && styles.dayChipActive]}
                >
                  <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>{label}</Text>
                </TouchableRipple>

                {active && window ? (
                  <View style={styles.timeCol}>
                    <View style={styles.timePickerGroup}>
                      <Text style={styles.timeLabel}>From</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hourList}>
                        {HOURS.slice(0, -1).map(h => (
                          <TouchableRipple
                            key={h}
                            borderless
                            onPress={() => setDayTime(dow, 'start', h)}
                            style={[styles.hourChip, window.start === h && styles.hourChipActive]}
                          >
                            <Text style={[styles.hourChipText, window.start === h && styles.hourChipTextActive]}>{h}</Text>
                          </TouchableRipple>
                        ))}
                      </ScrollView>
                    </View>
                    <View style={styles.timePickerGroup}>
                      <Text style={styles.timeLabel}>Until</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hourList}>
                        {HOURS.slice(1).map(h => (
                          <TouchableRipple
                            key={h}
                            borderless
                            onPress={() => setDayTime(dow, 'end', h)}
                            style={[styles.hourChip, window.end === h && styles.hourChipActive]}
                          >
                            <Text style={[styles.hourChipText, window.end === h && styles.hourChipTextActive]}>{h}</Text>
                          </TouchableRipple>
                        ))}
                      </ScrollView>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Time off</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>
            Tap a date to block it — you will not be offered jobs that day. Tap again to unblock.
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateList}>
            {dates.map(d => {
              const isBlocked = blocked.includes(d.date);
              return (
                <TouchableRipple
                  key={d.date}
                  borderless
                  onPress={() => toggleBlocked(d.date)}
                  style={[styles.dateChip, isBlocked && styles.dateChipBlocked]}
                >
                  <View style={styles.dateChipInner}>
                    <Text style={[styles.dateChipDay, isBlocked && styles.dateChipTextBlocked]}>{d.label}</Text>
                    <Text style={[styles.dateChipDate, isBlocked && styles.dateChipTextBlocked]}>{d.sub}</Text>
                    {isBlocked ? <Text style={styles.dateChipOff}>OFF</Text> : null}
                  </View>
                </TouchableRipple>
              );
            })}
          </ScrollView>
          {blocked.length > 0 ? (
            <Text style={styles.blockedSummary}>
              {blocked.length} day{blocked.length === 1 ? '' : 's'} blocked
            </Text>
          ) : null}
        </View>

        {activeDays === 0 ? (
          <Text style={styles.warning}>
            No working days set — you will not appear in customer searches or receive job offers.
          </Text>
        ) : null}

        <Button
          mode="contained"
          onPress={handleSave}
          loading={saving}
          disabled={saving || !dirty}
          style={styles.saveBtn}
          contentStyle={styles.saveBtnContent}
        >
          Save weekly hours
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sectionLabel: {
    ...typography.label,
    color: palette.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
  },
  hint: { ...typography.bodySmall, color: palette.textSecondary, marginBottom: spacing.md },

  dayRow: { marginBottom: spacing.sm },
  dayChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: r.full,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
  },
  dayChipActive: { backgroundColor: palette.primary, borderColor: palette.primary },
  dayChipText: { ...typography.label, color: palette.textSecondary },
  dayChipTextActive: { color: '#fff' },

  timeCol: { marginTop: spacing.xs, gap: spacing.xs },
  timePickerGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timeLabel: { ...typography.bodySmall, color: palette.textSecondary, width: 36 },
  hourList: { gap: spacing.xs, paddingVertical: 2 },
  hourChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: r.full,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
  },
  hourChipActive: { backgroundColor: palette.primaryLight, borderColor: palette.primary },
  hourChipText: { ...typography.bodySmall, color: palette.textSecondary },
  hourChipTextActive: { color: palette.primary, fontFamily: 'DMSans_600SemiBold' },

  dateList: { gap: spacing.xs, paddingVertical: 2 },
  dateChip: {
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
  },
  dateChipBlocked: { backgroundColor: palette.dangerLight, borderColor: palette.danger },
  dateChipInner: { alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minWidth: 56 },
  dateChipDay: { ...typography.label, color: palette.textSecondary },
  dateChipDate: { ...typography.bodySmall, color: palette.textPrimary },
  dateChipTextBlocked: { color: palette.danger },
  dateChipOff: { fontSize: 9, fontFamily: 'DMSans_600SemiBold', color: palette.danger, marginTop: 1 },
  blockedSummary: { ...typography.bodySmall, color: palette.textSecondary, marginTop: spacing.sm },

  warning: { ...typography.bodySmall, color: palette.danger, marginTop: spacing.md },

  saveBtn: { marginTop: spacing.lg, borderRadius: r.sm },
  saveBtnContent: { paddingVertical: 6 },
});
