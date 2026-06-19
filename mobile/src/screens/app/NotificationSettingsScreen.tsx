import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  useColorScheme,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChannelPreferences,
  NotificationCategory,
  NotificationChannel,
  NotificationSettings,
  QuietHours,
} from '../../api/notifications';
import { Card, Divider } from '../../components/ui/Card';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useNotificationStore } from '../../store/notificationStore';
import { palette, radius as r, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ── Theme ────────────────────────────────────────────────────────────────
type ThemeC = { bg: string; surface: string; border: string; t1: string; t2: string; t3: string };
const DARK:  ThemeC = { bg: '#0F0A0D', surface: '#1C1015', border: '#3A2030', t1: '#F5E8EE', t2: '#C79BB0', t3: '#7C5868' };
const LIGHT: ThemeC = { bg: palette.background, surface: palette.surface, border: palette.border, t1: palette.textPrimary, t2: palette.textSecondary, t3: palette.textDisabled };

// ── Category metadata ───────────────────────────────────────────────────

interface CatMeta {
  label:    string;
  desc:     string;
  icon:     IconName;
  critical: boolean;
}

const CATEGORIES: Record<NotificationCategory, CatMeta> = {
  bookings:     { label: 'Bookings & requests',  desc: 'New requests, status updates, reminders',       icon: 'calendar-outline',          critical: false },
  payments:     { label: 'Payments',              desc: 'Payment confirmations and reminders',           icon: 'wallet-outline',            critical: false },
  reviews:      { label: 'Reviews',               desc: 'New reviews and rating updates',                icon: 'star-outline',              critical: false },
  verification: { label: 'Verification & tier',   desc: 'KYC status, tier progress and unlocks',         icon: 'shield-checkmark-outline',  critical: false },
  moderation:   { label: 'Moderation',            desc: 'Listing visibility and compliance',             icon: 'alert-circle-outline',      critical: false },
  referrals:    { label: 'Referrals',             desc: 'Referral rewards and milestones',               icon: 'gift-outline',              critical: false },
  safety:       { label: 'Safety & critical',     desc: 'Safety alerts and admin notices. Cannot be fully disabled for your protection.', icon: 'warning-outline', critical: true },
  marketing:    { label: 'Tips & promotions',     desc: 'Feature tips, seasonal offers, community news', icon: 'megaphone-outline',         critical: false },
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push:   'Push',
  sms:    'SMS',
  in_app: 'In-app',
};

const CHANNEL_ORDER: NotificationChannel[] = ['push', 'sms', 'in_app'];
const CATEGORY_ORDER: NotificationCategory[] = [
  'bookings', 'payments', 'reviews', 'verification', 'moderation', 'referrals', 'safety', 'marketing',
];

// ── Component ───────────────────────────────────────────────────────────

export default function NotificationSettingsScreen() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? DARK : LIGHT;
  const nav = useNavigation();
  const { showSuccess, showError } = useSnackbar();

  const {
    settings,
    settingsLoading,
    fetchSettings,
    updateSettings,
  } = useNotificationStore();

  const [local, setLocal] = useState<NotificationSettings>(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchSettings(); }, []);
  useEffect(() => { setLocal(settings); }, [settings]);

  const toggleChannel = useCallback((cat: NotificationCategory, ch: NotificationChannel) => {
    const meta = CATEGORIES[cat];
    if (meta.critical && ch === 'in_app') return;

    setLocal((prev) => {
      const updated = { ...prev };
      const catPrefs = { ...updated.categories[cat] };
      catPrefs[ch] = !catPrefs[ch];

      if (meta.critical) {
        if (!catPrefs.push && !catPrefs.sms && !catPrefs.in_app) {
          catPrefs.in_app = true;
        }
      }

      updated.categories = { ...updated.categories, [cat]: catPrefs };
      return updated;
    });
  }, []);

  const toggleQuietHours = useCallback(() => {
    setLocal((prev) => ({
      ...prev,
      quiet_hours: { ...prev.quiet_hours, enabled: !prev.quiet_hours.enabled },
    }));
  }, []);

  const setQuietTime = useCallback((field: 'start' | 'end', value: string) => {
    setLocal((prev) => ({
      ...prev,
      quiet_hours: { ...prev.quiet_hours, [field]: value },
    }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateSettings(local);
      showSuccess('Settings saved');
      nav.goBack();
    } catch {
      showError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [local, updateSettings, showSuccess, nav]);

  const hasChanges = JSON.stringify(local) !== JSON.stringify(settings);

  // ── Render ──────────────────────────────────────────────────────────

  if (settingsLoading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top']}>
        <Header c={c} onBack={() => nav.goBack()} />
        <View style={styles.skeleton}>
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top']}>
      <Header c={c} onBack={() => nav.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Channel legend */}
        <View style={styles.legendRow}>
          <View style={styles.legendLabel} />
          {CHANNEL_ORDER.map((ch) => (
            <Text key={ch} style={[styles.legendText, { color: c.t3 }]}>
              {CHANNEL_LABELS[ch]}
            </Text>
          ))}
        </View>

        {/* Category cards */}
        <Card padding={0} style={[styles.catCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          {CATEGORY_ORDER.map((cat, idx) => {
            const meta = CATEGORIES[cat];
            const prefs = local.categories[cat];
            return (
              <React.Fragment key={cat}>
                {idx > 0 && <Divider />}
                <View style={styles.catRow}>
                  <View style={styles.catInfo}>
                    <View style={styles.catHeader}>
                      <Ionicons name={meta.icon} size={18} color={c.t2} />
                      <Text style={[styles.catLabel, { color: c.t1 }]}>{meta.label}</Text>
                      {meta.critical && (
                        <View style={styles.criticalBadge}>
                          <Ionicons name="lock-closed" size={10} color={palette.danger} />
                        </View>
                      )}
                    </View>
                    <Text style={[styles.catDesc, { color: c.t2 }]}>{meta.desc}</Text>
                  </View>
                  <View style={styles.toggleRow}>
                    {CHANNEL_ORDER.map((ch) => {
                      const locked = meta.critical && ch === 'in_app';
                      return (
                        <View key={ch} style={styles.toggleCell}>
                          <Switch
                            value={prefs[ch]}
                            onValueChange={() => toggleChannel(cat, ch)}
                            trackColor={{ false: c.border, true: palette.primaryLight }}
                            thumbColor={prefs[ch] ? palette.primary : '#ccc'}
                            disabled={locked}
                            accessibilityLabel={`${meta.label} ${CHANNEL_LABELS[ch]} notifications`}
                            accessibilityState={{ checked: prefs[ch], disabled: locked }}
                            style={styles.toggle}
                          />
                        </View>
                      );
                    })}
                  </View>
                </View>
              </React.Fragment>
            );
          })}
        </Card>

        {/* Quiet hours */}
        <Text style={[styles.sectionTitle, { color: c.t2 }]}>Quiet hours</Text>
        <Card style={[styles.quietCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.quietRow}>
            <View style={styles.quietInfo}>
              <Text style={[styles.catLabel, { color: c.t1 }]}>Enable quiet hours</Text>
              <Text style={[styles.catDesc, { color: c.t2 }]}>
                Pause non-critical notifications during set hours. Safety and critical alerts always come through.
              </Text>
            </View>
            <Switch
              value={local.quiet_hours.enabled}
              onValueChange={toggleQuietHours}
              trackColor={{ false: c.border, true: palette.primaryLight }}
              thumbColor={local.quiet_hours.enabled ? palette.primary : '#ccc'}
              accessibilityLabel="Enable quiet hours"
            />
          </View>

          {local.quiet_hours.enabled && (
            <>
              <Divider />
              <View style={styles.timeRow}>
                <TimeField
                  label="From"
                  value={local.quiet_hours.start}
                  onChange={(v) => setQuietTime('start', v)}
                  c={c}
                />
                <Text style={[styles.timeDash, { color: c.t3 }]}>—</Text>
                <TimeField
                  label="To"
                  value={local.quiet_hours.end}
                  onChange={(v) => setQuietTime('end', v)}
                  c={c}
                />
              </View>
            </>
          )}
        </Card>

        <Text style={[styles.footerNote, { color: c.t3 }]}>
          Safety and critical notifications cannot be fully disabled. At least one channel will remain active to protect you and your account.
        </Text>
      </ScrollView>

      {/* Save button */}
      {hasChanges && (
        <View style={[styles.bottomBar, { borderTopColor: c.border, backgroundColor: c.bg }]}>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save notification settings"
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          >
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save changes'}</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Header ──────────────────────────────────────────────────────────────

function Header({ c, onBack }: { c: ThemeC; onBack: () => void }) {
  return (
    <View style={[styles.header, { borderBottomColor: c.border }]}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={styles.headerBtn}
      >
        <Ionicons name="arrow-back" size={24} color={c.t1} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: c.t1 }]}>Notification settings</Text>
      <View style={styles.headerBtn} />
    </View>
  );
}

// ── Time field (simple HH:mm input) ─────────────────────────────────────

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

function TimeField({
  label,
  value,
  onChange,
  c,
}: {
  label:    string;
  value:    string;
  onChange: (v: string) => void;
  c:        ThemeC;
}) {
  const idx = TIMES.indexOf(value);
  const next = () => onChange(TIMES[(idx + 1) % TIMES.length]);
  const prev = () => onChange(TIMES[(idx - 1 + TIMES.length) % TIMES.length]);

  return (
    <View style={styles.timeField} accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.timeLabel, { color: c.t3 }]}>{label}</Text>
      <View style={styles.timeControls}>
        <Pressable onPress={prev} hitSlop={8} accessibilityLabel={`Decrease ${label}`} style={styles.timeBtn}>
          <Ionicons name="chevron-down" size={18} color={c.t2} />
        </Pressable>
        <Text style={[styles.timeValue, { color: c.t1 }]}>{value}</Text>
        <Pressable onPress={next} hitSlop={8} accessibilityLabel={`Increase ${label}`} style={styles.timeBtn}>
          <Ionicons name="chevron-up" size={18} color={c.t2} />
        </Pressable>
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  headerBtn:   { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.heading3, flex: 1, marginLeft: spacing.xs },

  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  skeleton:      { padding: spacing.md, gap: spacing.sm },

  // Legend row
  legendRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs, paddingRight: spacing.xs },
  legendLabel: { flex: 1 },
  legendText:  { ...typography.bodySmall, fontSize: 12, width: 52, textAlign: 'center' },

  // Category
  catCard: {},
  catRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: spacing.md },
  catInfo: { flex: 1 },
  catHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  catLabel:  { ...typography.bodySmall, fontFamily: 'DMSans_500Medium' },
  catDesc:   { ...typography.bodySmall, fontSize: 12, marginTop: 2 },
  criticalBadge: {
    width: 16, height: 16, borderRadius: r.full,
    backgroundColor: palette.dangerLight,
    alignItems: 'center', justifyContent: 'center',
  },
  toggleRow:  { flexDirection: 'row', gap: 0 },
  toggleCell: { width: 52, alignItems: 'center' },
  toggle:     { transform: [{ scale: 0.8 }] },

  // Quiet hours
  sectionTitle: { ...typography.label, marginTop: spacing.lg, marginBottom: spacing.xs, marginLeft: spacing.xs },
  quietCard: {},
  quietRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  quietInfo: { flex: 1 },
  timeRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  timeDash:  { ...typography.body, marginTop: spacing.md },

  timeField:    { alignItems: 'center' },
  timeLabel:    { ...typography.bodySmall, fontSize: 12, marginBottom: spacing.xs },
  timeControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timeBtn:      { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  timeValue:    { ...typography.heading3, minWidth: 60, textAlign: 'center' },

  footerNote: { ...typography.bodySmall, fontSize: 12, marginTop: spacing.md, textAlign: 'center', paddingHorizontal: spacing.lg },

  // Bottom save bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    backgroundColor: palette.primary,
    borderRadius: r.sm,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 44,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { ...typography.label, color: '#fff' },
});
