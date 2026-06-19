import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, useColorScheme, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { storageUrl } from '../../api/client';
import { EARNED_BADGE_META, VettingBadge } from '../../components/discovery/VettingBadge';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { CardSkeleton } from '../../components/ui/SkeletonBlock';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { palette, radius as r, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type TabKey = 'profile' | 'account';

type ThemeC = { bg: string; surface: string; border: string; t1: string; t2: string; t3: string };
const DARK:  ThemeC = { bg: '#0F0A0D', surface: '#1C1015', border: '#3A2030', t1: '#F5E8EE', t2: '#C79BB0', t3: '#7C5868' };
const LIGHT: ThemeC = { bg: palette.background, surface: palette.surface, border: palette.border, t1: palette.textPrimary, t2: palette.textSecondary, t3: palette.textDisabled };

const LANG: Record<string, string> = { en: 'English', ny: 'Nyanja', bem: 'Bemba', ton: 'Tonga' };
const MOMO: Record<string, string> = { MTN: 'MTN MoMo', AIRTEL: 'Airtel Money', ZAMTEL: 'Zamtel Kwacha' };

function initials(name?: string | null): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}
function fmtRate(v: number | null | undefined): string {
  return v != null ? `${(v * 100).toFixed(0)}%` : '–';
}
function img(u: string | null | undefined): string | null {
  if (!u) return null;
  return u.startsWith('http') ? u : storageUrl(u);
}

// ── Primitives ───────────────────────────────────────────────────────────────
function Divider({ c }: { c: ThemeC }) { return <View style={[styles.divider, { backgroundColor: c.border }]} />; }

function Row({ icon, label, value, sub, onPress, c, danger, warn }: {
  icon: IconName; label: string; value?: string; sub?: string; onPress?: () => void; c: ThemeC; danger?: boolean; warn?: boolean;
}) {
  const fg = danger ? palette.danger : warn ? palette.warning : c.t1;
  return (
    <TouchableRipple onPress={onPress} borderless accessibilityRole="button" accessibilityLabel={value ? `${label}: ${value}` : label}>
      <View style={styles.row}>
        <View style={[styles.iconChip, { backgroundColor: warn ? palette.warningLight : danger ? palette.dangerLight : palette.primaryLight }]}>
          <Ionicons name={icon} size={18} color={danger ? palette.danger : warn ? palette.warning : palette.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, { color: fg }]} numberOfLines={1}>{label}</Text>
          {sub && <Text style={[styles.rowSub, { color: warn ? palette.warning : c.t2 }]} numberOfLines={2}>{sub}</Text>}
        </View>
        {value && <Text style={[styles.rowValue, { color: c.t2 }]} numberOfLines={1}>{value}</Text>}
        {onPress && <Ionicons name="chevron-forward" size={16} color={c.t3} />}
      </View>
    </TouchableRipple>
  );
}

function StatTile({ icon, value, label, c }: { icon: IconName; value: string; label: string; c: ThemeC }) {
  return (
    <View style={styles.statTile} accessibilityLabel={`${label}: ${value}`}>
      <Ionicons name={icon} size={18} color={palette.primary} />
      <Text style={[styles.statValue, { color: c.t1 }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: c.t2 }]}>{label}</Text>
    </View>
  );
}

function TabBar({ c, active, onChange }: { c: ThemeC; active: TabKey; onChange: (k: TabKey) => void }) {
  const tabs: { key: TabKey; label: string }[] = [{ key: 'profile', label: 'Profile' }, { key: 'account', label: 'Account' }];
  return (
    <View style={[styles.tabBar, { borderBottomColor: c.border }]} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <TouchableRipple key={t.key} onPress={() => onChange(t.key)} borderless
            accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label} style={styles.tabTap}>
            <View style={[styles.tab, on && { borderBottomColor: palette.primary }]}>
              <Text style={[styles.tabText, { color: on ? palette.primary : c.t2 }, on && styles.tabTextActive]}>{t.label}</Text>
            </View>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

export default function ProviderAccountScreen({ navigation }: any) {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? DARK : LIGHT;
  const insets = useSafeAreaInsets();
  const { profile, dashboard, loading, fetchProfile, fetchDashboard } = useProfileStore();
  const { user, logout, setActiveRole } = useAuthStore();
  const [tab, setTab] = useState<TabKey>('profile');

  useEffect(() => { fetchProfile(); fetchDashboard(); }, []);

  const editProfile  = () => navigation.navigate('ProviderProfileEdit');
  const soon = (what: string) => () => navigation.navigate('ProviderProfileEdit'); // editors out of scope → profile editor

  if (loading && (!profile || !dashboard)) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <CardSkeleton style={{ height: 150, borderRadius: r.sm }} />
          {[1, 2, 3].map((k) => <CardSkeleton key={k} style={{ height: 56, borderRadius: r.sm }} />)}
        </View>
      </SafeAreaView>
    );
  }
  if (!profile || !dashboard) return <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top']} />;

  const stats        = dashboard.stats;
  const name         = dashboard.display_name ?? profile.display_name ?? 'Provider';
  const avatarUri    = img(dashboard.profile_photo_url);
  const coverUri     = img(profile.cover_image_url);
  const verified     = profile.trust_tier >= 2; // identity (ID) verified at Tier 2+
  const isDirect     = dashboard.payment_mode === 'DIRECT';
  const languages    = (profile.languages ?? []).map((l) => LANG[l] ?? l).join(' · ');
  const momoSet      = !!profile.momo_number;
  const portfolioN   = profile.portfolio_images?.length ?? 0;
  const badges       = dashboard.earned_badges ?? [];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <ScreenHeader title="Profile" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>

        {/* ── Header: cover + avatar + identity ── */}
        <View style={styles.header}>
          <View style={[styles.cover, { backgroundColor: c.border }]}>
            {coverUri && <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />}
            <TouchableRipple onPress={editProfile} borderless style={styles.coverEdit} accessibilityLabel="Edit cover photo">
              <Ionicons name="camera-outline" size={16} color="#fff" />
            </TouchableRipple>
          </View>
          <View style={styles.headerBody}>
            <View style={[styles.avatar, { borderColor: c.bg }]}>
              {avatarUri
                ? <Image source={{ uri: avatarUri }} style={styles.avatarImg} contentFit="cover" accessibilityLabel="Profile photo" />
                : <View style={[styles.avatarImg, styles.avatarFallback]}><Text style={styles.avatarText}>{initials(name)}</Text></View>}
            </View>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: c.t1 }]} numberOfLines={1}>{name}</Text>
              {verified && <Ionicons name="checkmark-circle" size={18} color={palette.success} accessibilityLabel="Identity verified" />}
            </View>
            <View style={styles.metaRow}>
              <VettingBadge trustTier={profile.trust_tier} size="sm" />
              {!!profile.base_location_label && (
                <Text style={[styles.location, { color: c.t2 }]} numberOfLines={1}>· {profile.base_location_label}</Text>
              )}
            </View>
          </View>
        </View>

        <TabBar c={c} active={tab} onChange={setTab} />

        {tab === 'profile' ? (
          <View style={styles.section}>
            {/* Stats — Bayesian rating (§7.1), response, repeat */}
            <View style={styles.statsRow}>
              <StatTile icon="star" value={stats?.rating != null ? stats.rating.toFixed(1) : '–'} label="Rating" c={c} />
              <View style={[styles.statDivider, { backgroundColor: c.border }]} />
              <StatTile icon="chatbox-ellipses-outline" value={String(stats?.reviews ?? 0)} label="Reviews" c={c} />
              <View style={[styles.statDivider, { backgroundColor: c.border }]} />
              <StatTile icon="flash-outline" value={stats?.response_time_p50_mins != null ? `${stats.response_time_p50_mins}m` : '–'} label="Response" c={c} />
              <View style={[styles.statDivider, { backgroundColor: c.border }]} />
              <StatTile icon="repeat-outline" value={fmtRate(stats?.repeat_client_rate)} label="Repeat" c={c} />
            </View>

            {/* Earned badges (§9.2) */}
            {badges.length > 0 && (
              <View style={styles.badgeRow}>
                {badges.map((key) => {
                  const meta = EARNED_BADGE_META[key];
                  if (!meta) return null;
                  return (
                    <View key={key} style={[styles.badgeChip, { borderColor: meta.color }]}>
                      <Ionicons name={meta.icon as any} size={12} color={meta.color} />
                      <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Preview as customer */}
            <TouchableRipple
              onPress={() => navigation.navigate('ProviderProfile', { providerId: user?.id })}
              borderless style={[styles.previewBtn, { borderColor: c.border }]}
              accessibilityRole="button" accessibilityLabel="Preview your profile as a customer sees it">
              <View style={styles.previewInner}>
                <Ionicons name="eye-outline" size={18} color={palette.primary} />
                <Text style={[styles.previewText, { color: c.t1 }]}>Preview as customer</Text>
              </View>
            </TouchableRipple>

            <Divider c={c} />
            <Text style={[styles.groupLabel, { color: c.t2 }]}>Manage</Text>
            <Row icon="document-text-outline" label="About & languages" sub={languages || 'Add your bio and languages'} onPress={editProfile} c={c} />
            <Divider c={c} />
            <Row icon="sparkles-outline" label="Highlights" sub="Pinned service, photos & badges" onPress={editProfile} c={c} />
            <Divider c={c} />
            <Row icon="images-outline" label="Portfolio" value={`${portfolioN}/12`} onPress={editProfile} c={c} />
            <Divider c={c} />
            <Row icon="construct-outline" label="Services" value={String(stats?.active_services ?? 0)} onPress={() => navigation.navigate('Services')} c={c} />
          </View>
        ) : (
          <View style={styles.section}>
            {/* Verification */}
            <Text style={[styles.groupLabel, { color: c.t2 }]}>Verification</Text>
            <View style={styles.verifyHead}>
              <Text style={[styles.verifyTier, { color: c.t1 }]}>{dashboard.tier.label}</Text>
              <View style={styles.verifyLine}>
                <Ionicons name={verified ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={verified ? palette.success : c.t3} />
                <Text style={[styles.verifySub, { color: c.t2 }]}>{verified ? 'Identity (ID) verified' : 'Identity not yet verified'}</Text>
              </View>
            </View>
            {dashboard.next_tier ? (
              <Row icon="trophy-outline" label={`Reach ${dashboard.next_tier.label}`}
                sub={dashboard.next_tier.requirements?.[0]} onPress={() => navigation.navigate('Kyc')} c={c} />
            ) : (
              <Row icon="trophy-outline" label="Top tier achieved" sub="You're at Sebenza's highest trust tier" c={c} />
            )}

            <Divider c={c} />

            {/* Getting paid — payment_mode-aware */}
            <Text style={[styles.groupLabel, { color: c.t2 }]}>Getting paid</Text>
            {isDirect ? (
              <>
                <Row
                  icon="phone-portrait-outline"
                  label="Payment details"
                  value={momoSet ? `${MOMO[profile.momo_provider ?? ''] ?? profile.momo_provider ?? ''} ${profile.momo_number}`.trim() : undefined}
                  sub={momoSet ? undefined : 'Add your mobile-money number so customers can pay you'}
                  warn={!momoSet}
                  onPress={editProfile}
                  c={c}
                />
                <Text style={[styles.privacyNote, { color: c.t3 }]}>
                  Shared only with customers who have an active booking — never shown on your public profile.
                </Text>
              </>
            ) : (
              <Row icon="card-outline" label="Payout details" sub="Bank or mobile-money account for escrow payouts" onPress={editProfile} c={c} />
            )}

            <Divider c={c} />

            {/* Settings */}
            <Text style={[styles.groupLabel, { color: c.t2 }]}>Settings</Text>
            <Row icon="person-outline" label="Personal info" onPress={editProfile} c={c} />
            <Divider c={c} />
            <Row icon="notifications-outline" label="Notifications" onPress={soon('Notifications')} c={c} />
            <Divider c={c} />
            <Row icon="gift-outline" label="Invite a friend"
              sub={dashboard.referral_code ? `Your code: ${dashboard.referral_code}` : 'Earn ZMW 20 per referral'} onPress={soon('Referrals')} c={c} />
            <Divider c={c} />
            <Row icon="swap-horizontal-outline" label="Switch to customer" onPress={() => setActiveRole('CUSTOMER')} c={c} />
            <Divider c={c} />
            <Row icon="help-circle-outline" label="Help & support" onPress={soon('Help')} c={c} />
            <Divider c={c} />
            <Row icon="log-out-outline" label="Sign out" onPress={logout} c={c} danger />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: { },
  cover: { height: 100, width: '100%' },
  coverEdit: {
    position: 'absolute', right: spacing.md, bottom: spacing.sm,
    width: 32, height: 32, borderRadius: r.sm, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerBody: { paddingHorizontal: spacing.lg, marginTop: -32 },
  avatar: { width: 72, height: 72, borderRadius: r.full, borderWidth: 3, overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%', borderRadius: r.full },
  avatarFallback: { backgroundColor: palette.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'DMSans_600SemiBold', fontSize: 24, color: palette.primary },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  name: { ...typography.heading2, fontSize: 22, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 },
  location: { ...typography.bodySmall, fontSize: 13, flexShrink: 1 },

  // Tabs
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, marginTop: spacing.md, paddingHorizontal: spacing.lg },
  tabTap: { flex: 1, borderRadius: r.sm },
  tab: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { ...typography.body, fontSize: 15 },
  tabTextActive: { fontFamily: 'DMSans_500Medium' },

  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  groupLabel: { ...typography.label, fontSize: 13, marginBottom: spacing.xs, marginTop: spacing.xs },

  // Stats
  statsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  statTile: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: spacing.xs },
  statValue: { fontFamily: 'DMSans_600SemiBold', fontSize: 16, lineHeight: 22 },
  statLabel: { ...typography.bodySmall, fontSize: 11 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36 },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  badgeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: r.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  badgeText: { fontFamily: 'DMSans_500Medium', fontSize: 11 },

  previewBtn: { borderWidth: 1, borderRadius: r.sm },
  previewInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 44 },
  previewText: { ...typography.label, fontSize: 14 },

  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.sm },

  // Rows
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.xs },
  iconChip: { width: 38, height: 38, borderRadius: r.sm, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...typography.body, fontSize: 16 },
  rowSub: { ...typography.bodySmall, fontSize: 12, marginTop: 1 },
  rowValue: { ...typography.bodySmall, fontSize: 13 },

  verifyHead: { marginBottom: spacing.xs },
  verifyTier: { ...typography.heading3, fontSize: 18 },
  verifyLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  verifySub: { ...typography.bodySmall, fontSize: 13 },

  privacyNote: { ...typography.bodySmall, fontSize: 12, lineHeight: 17, marginTop: spacing.xs, marginLeft: 38 + spacing.md },
});
