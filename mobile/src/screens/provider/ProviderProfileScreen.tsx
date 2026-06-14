import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { Chip, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SkeletonBlock } from '../../components/ui/SkeletonBlock';
import { MarkdownView } from '../../components/ui/MarkdownView';
import { EARNED_BADGE_META, VettingBadge } from '../../components/discovery/VettingBadge';
import { PublicProviderProfile, PublicReview, providersApi } from '../../api/providers';
import { storageUrl } from '../../api/client';
import { ApiError } from '../../api/errors';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export default function ProviderProfileScreen({ route, navigation }: any) {
  const { providerId } = route.params as { providerId: string };
  const [profile, setProfile] = useState<PublicProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { showError } = useSnackbar();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await providersApi.getProfile(providerId);
        setProfile(data);
      } catch (e) {
        showError(e instanceof ApiError ? e.message : 'Failed to load profile.');
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [providerId]);

  if (loading || !profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <ProfileSkeleton />
      </SafeAreaView>
    );
  }

  // null = no history yet (backend v3.2 §4.1) — show "–", never a fake 0%
  const completionLabel = profile.completion_rate != null
    ? `${Math.round(profile.completion_rate * 100)}%`
    : '–';
  const matrix = profile.profile.availability_matrix;
  const displayName = profile.display_name ?? 'Provider';

  // Badges: provider-featured first, then the rest of what they've earned.
  const featured = profile.highlights?.featured_badges ?? [];
  const badges = [
    ...featured,
    ...(profile.earned_badges ?? []).filter((b) => !featured.includes(b)),
  ];

  // Portfolio: featured photos first, then the rest.
  const featuredPhotos = profile.highlights?.featured_photo_keys ?? [];
  const portfolio = [
    ...featuredPhotos,
    ...(profile.portfolio_images ?? []).filter((p) => !featuredPhotos.includes(p)),
  ];

  const sinceLabel = profile.year_started ? `Since ${profile.year_started}` : null;
  const languagesLabel = (profile.languages ?? []).length > 0
    ? profile.languages.map((c) => ({ en: 'English', ny: 'Nyanja', bem: 'Bemba', ton: 'Tonga' }[c] ?? c)).join(' · ')
    : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Hero gradient */}
        <LinearGradient
          colors={['#7B1A3A', '#C2476A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <TouchableRipple
            onPress={() => navigation.goBack()}
            borderless
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
          </TouchableRipple>

          <View style={styles.avatarRing}>
            {profile.avatar_url ? (
              <Image
                source={{ uri: profile.avatar_url.startsWith('http') ? profile.avatar_url : storageUrl(profile.avatar_url) }}
                style={styles.avatarImage}
                accessibilityRole="image"
                accessibilityLabel={`${displayName}'s profile photo`}
              />
            ) : (
              <MaterialCommunityIcons name="account" size={44} color={palette.primary} />
            )}
          </View>
          <Text style={styles.heroName}>{displayName}</Text>
          <VettingBadge trustTier={profile.trust_tier} size="sm" />
          {(sinceLabel || profile.base_location_label) && (
            <Text style={styles.heroMeta}>
              {[profile.base_location_label, sinceLabel].filter(Boolean).join(' · ')}
            </Text>
          )}
        </LinearGradient>

        {/* Earned & featured badges */}
        {badges.length > 0 && (
          <View style={styles.badgeRow}>
            {badges.map((key) => {
              const meta = EARNED_BADGE_META[key];
              if (!meta) return null;
              return (
                <View key={key} style={[styles.badgeChip, { borderColor: meta.color }]}>
                  <Ionicons name={meta.icon as any} size={12} color={meta.color} />
                  <Text style={[styles.badgeChipText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Stats strip */}
        <View style={styles.statsStrip}>
          <StatCell icon="star" iconColor={palette.warning} value={profile.r_raw.toFixed(1)} label="Rating" />
          <View style={styles.statDivider} />
          <StatCell icon="comment-multiple-outline" iconColor={palette.primary} value={String(profile.v_reviews)} label="Reviews" />
          <View style={styles.statDivider} />
          <StatCell icon="check-circle-outline" iconColor={palette.success} value={completionLabel} label="Completion" />
          <View style={styles.statDivider} />
          <StatCell icon="briefcase-check-outline" iconColor={palette.secondary} value={String(profile.jobs_done ?? 0)} label="Jobs done" />
        </View>

        <View style={styles.body}>
          {/* Bio */}
          {!!profile.bio && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <View style={styles.card}>
                <MarkdownView>{profile.bio}</MarkdownView>
              </View>
            </View>
          )}

          {/* Languages */}
          {languagesLabel && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Languages</Text>
              <View style={styles.card}>
                <Text style={styles.languagesText}>{languagesLabel}</Text>
              </View>
            </View>
          )}

          {/* Portfolio — the provider's work, featured photos first */}
          {portfolio.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Portfolio ({portfolio.length})</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.portfolioRow}>
                {portfolio.map((path) => (
                  <Image
                    key={path}
                    source={{ uri: path.startsWith('http') ? path : storageUrl(path) }}
                    style={styles.portfolioImage}
                    accessibilityRole="image"
                    accessibilityLabel="Portfolio photo"
                  />
                ))}
              </ScrollView>
            </View>
          )}

          {/* Availability */}
          {matrix && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Availability</Text>
              <View style={[styles.card, styles.availGrid]}>
                {DAYS.map((day) => {
                  const slots = matrix[day] ?? [];
                  const active = slots.length > 0;
                  return (
                    <View key={day} style={[styles.dayCell, active && styles.dayCellActive]}>
                      <Text style={[styles.dayLabel, active && styles.dayLabelActive]}>{day}</Text>
                      {active ? (
                        slots.map((slot, i) => (
                          <Text key={i} style={styles.slotText}>{slot.start}–{slot.end}</Text>
                        ))
                      ) : (
                        <Text style={styles.offText}>Off</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Services */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Services ({profile.services.length})</Text>
            {profile.services.length === 0 ? (
              <View style={styles.emptyBox}>
                <MaterialCommunityIcons name="briefcase-outline" size={36} color={palette.textDisabled} />
                <Text style={styles.emptyText}>No active services listed.</Text>
              </View>
            ) : (
              profile.services.map((svc) => (
                <TouchableRipple
                  key={svc.id}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    navigation.navigate('ServiceDetail', { serviceId: svc.id });
                  }}
                  borderless
                  style={styles.svcCard}
                >
                  <View style={styles.svcInner}>
                    <View style={styles.svcLeft}>
                      <View style={styles.svcTitleRow}>
                        {svc.is_pinned && (
                          <MaterialCommunityIcons name="pin" size={14} color={palette.primary} accessibilityLabel="Pinned by provider" />
                        )}
                        <Text style={styles.svcTitle} numberOfLines={2}>{svc.title}</Text>
                      </View>
                      <Chip compact style={styles.svcChip} textStyle={styles.svcChipText}>
                        {svc.category.name}
                      </Chip>
                    </View>
                    <View style={styles.svcRight}>
                      <Text style={styles.svcPrice}>
                        {svc.pricing_model === 'QUOTE' || svc.base_price == null
                          ? 'By quote'
                          : `ZMW ${svc.base_price.toFixed(0)}`}
                      </Text>
                      <MaterialCommunityIcons name="chevron-right" size={18} color={palette.textDisabled} />
                    </View>
                  </View>
                </TouchableRipple>
              ))
            )}
          </View>

          {/* Reviews */}
          {profile.reviews.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reviews ({profile.reviews.length})</Text>
              {profile.reviews.map((rev) => (
                <ReviewCard key={rev.id} review={rev} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCell({ icon, iconColor, value, label }: { icon: string; iconColor: string; value: string; label: string }) {
  return (
    <View style={styles.statCell}>
      <MaterialCommunityIcons name={icon as any} size={18} color={iconColor} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ReviewCard({ review }: { review: PublicReview }) {
  const stars = Math.round(review.rating);
  const date  = new Date(review.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewerRow}>
          <View style={styles.reviewerAvatar}>
            <MaterialCommunityIcons name="account" size={16} color={palette.textSecondary} />
          </View>
          <Text style={styles.reviewerName}>{review.reviewer.name}</Text>
        </View>
        <Text style={styles.reviewDate}>{date}</Text>
      </View>
      <View style={styles.starsRow}>
        {Array.from({ length: 5 }).map((_, i) => (
          <MaterialCommunityIcons
            key={i}
            name={i < stars ? 'star' : 'star-outline'}
            size={14}
            color={i < stars ? palette.warning : palette.textDisabled}
          />
        ))}
      </View>
      {!!review.comment && (
        <Text style={styles.reviewComment}>{review.comment}</Text>
      )}
    </View>
  );
}

function ProfileSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <SkeletonBlock width="100%" height={180} radius={0} style={{ marginBottom: spacing.md }} />
      <SkeletonBlock width="60%" height={20} style={{ alignSelf: 'center', marginBottom: spacing.xs }} />
      <SkeletonBlock width="40%" height={14} style={{ alignSelf: 'center', marginBottom: spacing.xl }} />
      <SkeletonBlock width="100%" height={80} radius={r.lg} style={{ marginBottom: spacing.md }} />
      <SkeletonBlock width="100%" height={120} radius={r.lg} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: palette.background },
  scrollContent:{ paddingBottom: spacing.xxl },

  hero: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  backBtn: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    width: 38,
    height: 38,
    borderRadius: r.full,
    backgroundColor: '#FFFFFF22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  heroName: {
    ...typography.heading2,
    color: '#FFFFFF',
    marginBottom: spacing.xs,
  },
  avatarImage: {
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  heroMeta: {
    ...typography.bodySmall,
    color: '#FFFFFFCC',
    fontSize: 12,
    marginTop: spacing.xs,
  },

  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  badgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderRadius: r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: palette.surface,
  },
  badgeChipText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11 },

  languagesText: { ...typography.body, color: palette.textSecondary },

  portfolioRow: { gap: spacing.sm, paddingRight: spacing.lg },
  portfolioImage: {
    width: 140,
    height: 105,
    borderRadius: r.lg,
    backgroundColor: palette.border,
  },

  statsStrip: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    ...shadow.card,
  },
  statCell:    { flex: 1, alignItems: 'center', paddingVertical: spacing.md, gap: 2 },
  statDivider: { width: 1, backgroundColor: palette.border, marginVertical: spacing.sm },
  statValue:   { ...typography.heading3, color: palette.textPrimary, fontSize: 16 },
  statLabel:   { ...typography.bodySmall, color: palette.textSecondary, fontSize: 10 },

  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },

  section:      { marginBottom: spacing.lg },
  sectionTitle: { ...typography.heading3, color: palette.textPrimary, marginBottom: spacing.sm },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    ...shadow.card,
  },

  availGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  dayCell: {
    flex: 1,
    minWidth: 44,
    backgroundColor: palette.border,
    borderRadius: r.md,
    padding: spacing.xs,
    alignItems: 'center',
  },
  dayCellActive:  { backgroundColor: palette.primaryLight },
  dayLabel:       { ...typography.label, color: palette.textSecondary, fontSize: 11, marginBottom: 2 },
  dayLabelActive: { color: palette.primary },
  slotText:       { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 9, color: palette.textSecondary, textAlign: 'center' },
  offText:        { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: palette.textDisabled },

  svcCard: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.xs,
    overflow: 'hidden',
    ...shadow.card,
  },
  svcInner:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  svcLeft:    { flex: 1, marginRight: spacing.sm },
  svcRight:   { alignItems: 'flex-end' },
  svcTitleRow:{ flexDirection: 'row', alignItems: 'center', gap: 4 },
  svcTitle:   { ...typography.label, color: palette.textPrimary, fontSize: 14, marginBottom: spacing.xs, flexShrink: 1 },
  svcChip:    { alignSelf: 'flex-start', height: 24, backgroundColor: palette.primaryLight },
  svcChipText:{ ...typography.bodySmall, color: palette.primary, fontSize: 11 },
  svcPrice:   { ...typography.label, color: palette.primary, fontSize: 15 },

  emptyBox:  { alignItems: 'center', paddingVertical: spacing.xl },
  emptyText: { ...typography.body, color: palette.textSecondary, marginTop: spacing.sm },

  reviewCard: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  reviewHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  reviewerRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  reviewerAvatar:{
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: palette.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  reviewerName:  { ...typography.label, color: palette.textPrimary, fontSize: 13 },
  reviewDate:    { ...typography.bodySmall, color: palette.textDisabled },
  starsRow:      { flexDirection: 'row', gap: 2, marginBottom: spacing.xs },
  reviewComment: { ...typography.body, color: palette.textSecondary, fontSize: 13 },

  skeletonWrap: { padding: spacing.lg },
});
