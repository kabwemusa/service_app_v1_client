import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { storageUrl } from '../../api/client';
import { Highlights, LanguageCode } from '../../api/providerProfile';
import { EARNED_BADGE_META } from '../../components/discovery/VettingBadge';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useProfileStore } from '../../store/profileStore';
import { useServiceStore } from '../../store/serviceStore';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { OnboardingProgress } from '../../components/provider/OnboardingProgress';
import { palette, radius as r, spacing, typography } from '../../theme';

const SCREEN_W   = Dimensions.get('window').width;
const PHOTO_GAP  = spacing.sm;
const PHOTO_SIZE = (SCREEN_W - spacing.lg * 2 - PHOTO_GAP * 2) / 3;

const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en:  'English',
  ny:  'Nyanja',
  bem: 'Bemba',
  ton: 'Tonga',
};
const LANGUAGE_CODES = Object.keys(LANGUAGE_LABELS) as LanguageCode[];

const EMPTY_HIGHLIGHTS: Highlights = { pinned_service_ids: [], featured_photo_keys: [], featured_badges: [] };

// A public provider profile needs a real name + a bio that says what they do.
// The bio only earns profile-strength points at ≥ 80 chars (backend §9.1), so we
// guide the provider to that length rather than let them save an empty shell.
const BIO_MIN = 80;

type FieldErrors = { displayName?: string; bio?: string; year?: string };

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export default function ProviderProfileEditScreen({ navigation, route }: any) {
  const onboardingStep: number | undefined = route?.params?.onboardingStep;
  const {
    profile, dashboard, error,
    fetchProfile, fetchDashboard, upsertProfile,
    uploadCoverPhoto, uploadPortfolioImage, deletePortfolioImage, clearError,
  } = useProfileStore();
  const { myServices, fetchMyServices } = useServiceStore();
  const { showSuccess, showError, showSnackbar } = useSnackbar();
  const insets = useSafeAreaInsets();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio]                 = useState('');
  const [yearStarted, setYearStarted] = useState('');
  const [languages, setLanguages]     = useState<LanguageCode[]>([]);
  const [highlights, setHighlights]   = useState<Highlights>(EMPTY_HIGHLIGHTS);

  const [saving, setSaving]                   = useState(false);
  const [uploadingCover, setUploadingCover]   = useState(false);
  const [uploadingPhoto, setUploadingPhoto]   = useState(false);
  const [deletingPath, setDeletingPath]       = useState<string | null>(null);
  const [errors, setErrors]                   = useState<FieldErrors>({});

  const scrollRef = useRef<ScrollView>(null);
  const clearErr = (field: keyof FieldErrors) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  useEffect(() => {
    fetchProfile();
    fetchDashboard();
    fetchMyServices(true);
  }, []);

  // Hydrate once per profile load — `user_id` is stable, so this never clobbers in-progress edits.
  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? '');
    setBio(profile.bio ?? '');
    setYearStarted(profile.year_started ? String(profile.year_started) : '');
    setLanguages(profile.languages ?? []);
    setHighlights(profile.highlights ?? EMPTY_HIGHLIGHTS);
  }, [profile?.user_id]);

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const bioErr = error?.isValidation ? error.fieldError('bio') : null;
  const portfolioImages = profile?.portfolio_images ?? [];
  const earnedBadges = dashboard?.earned_badges ?? [];
  const activeServices = myServices.filter((s) => s.status === 'ACTIVE' || s.status === 'PAUSED');

  // ── Languages ────────────────────────────────────────────────────────────
  const toggleLanguage = (code: LanguageCode) => {
    Haptics.selectionAsync();
    setLanguages((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
      if (prev.length >= 4) {
        showSnackbar({ message: 'You can pick up to 4 languages.', variant: 'info' });
        return prev;
      }
      return [...prev, code];
    });
  };

  // ── Profile / cover photo ────────────────────────────────────────────────
  const handleUploadCover = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showError('Photo library access is required to set your profile photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]) return;

    setUploadingCover(true);
    try {
      await uploadCoverPhoto(result.assets[0].uri);
      showSuccess('Profile photo updated.');
    } catch {
    } finally {
      setUploadingCover(false);
    }
  };

  // ── Portfolio manager (§5.3 — max 12 images, 5MB each) ───────────────────
  const handleAddPhoto = async () => {
    if (portfolioImages.length >= 12) {
      showSnackbar({ message: 'You’ve reached the 12-image portfolio limit.', variant: 'info' });
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showError('Photo library access is required to add portfolio images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (result.canceled || !result.assets[0]) return;

    setUploadingPhoto(true);
    try {
      await uploadPortfolioImage(result.assets[0].uri);
      showSuccess('Portfolio image added.');
    } catch {
    } finally {
      setUploadingPhoto(false);
    }
  };

  const confirmRemovePhoto = (path: string) => {
    Alert.alert('Remove image', 'Delete this image from your portfolio? Featured spots referencing it will be cleared too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingPath(path);
          try {
            await deletePortfolioImage(path);
            setHighlights((prev) => ({ ...prev, featured_photo_keys: prev.featured_photo_keys.filter((p) => p !== path) }));
          } catch {
          } finally {
            setDeletingPath(null);
          }
        },
      },
    ]);
  };

  // ── Highlights — pinned services (reorder via chevrons, §5.4/§6.6) ──────
  const togglePinnedService = (id: string) => {
    Haptics.selectionAsync();
    setHighlights((prev) => {
      if (prev.pinned_service_ids.includes(id)) {
        return { ...prev, pinned_service_ids: prev.pinned_service_ids.filter((x) => x !== id) };
      }
      if (prev.pinned_service_ids.length >= 6) {
        showSnackbar({ message: 'You can pin up to 6 services.', variant: 'info' });
        return prev;
      }
      return { ...prev, pinned_service_ids: [...prev.pinned_service_ids, id] };
    });
  };

  const movePinnedService = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= highlights.pinned_service_ids.length) return;
    Haptics.selectionAsync();
    setHighlights((prev) => {
      const next = [...prev.pinned_service_ids];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, pinned_service_ids: next };
    });
  };

  // ── Highlights — featured photos & badges (toggle pickers) ──────────────
  const toggleFeaturedPhoto = (path: string) => {
    Haptics.selectionAsync();
    setHighlights((prev) => {
      if (prev.featured_photo_keys.includes(path)) {
        return { ...prev, featured_photo_keys: prev.featured_photo_keys.filter((p) => p !== path) };
      }
      if (prev.featured_photo_keys.length >= 6) {
        showSnackbar({ message: 'You can feature up to 6 photos.', variant: 'info' });
        return prev;
      }
      return { ...prev, featured_photo_keys: [...prev.featured_photo_keys, path] };
    });
  };

  const toggleFeaturedBadge = (key: string) => {
    Haptics.selectionAsync();
    setHighlights((prev) => {
      if (prev.featured_badges.includes(key)) {
        return { ...prev, featured_badges: prev.featured_badges.filter((b) => b !== key) };
      }
      if (prev.featured_badges.length >= 6) {
        showSnackbar({ message: 'You can feature up to 6 badges.', variant: 'info' });
        return prev;
      }
      return { ...prev, featured_badges: [...prev.featured_badges, key] };
    });
  };

  // ── Validation ─────────────────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  // Block only on what's genuinely MISSING (empty required fields / bad year).
  // A short-but-present bio is guided softly below, never trapping an existing
  // provider who is just tweaking a highlight.
  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!displayName.trim()) {
      e.displayName = 'Add the name customers will see on your profile.';
    }
    if (!bio.trim()) {
      e.bio = 'Write a short bio so customers know what you do.';
    }
    if (yearStarted.trim()) {
      const y = parseInt(yearStarted, 10);
      if (Number.isNaN(y) || y < 1980 || y > currentYear) {
        e.year = `Enter a year between 1980 and ${currentYear}.`;
      }
    }
    return e;
  };

  // Non-blocking nudge: bio present but under the strength threshold.
  const bioTrimmed = bio.trim().length;
  const bioWeak = bioTrimmed > 0 && bioTrimmed < BIO_MIN;

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length > 0) {
      // Guide the provider straight to what's missing rather than a vague toast.
      setErrors(e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      showError('Please complete the highlighted fields to save your profile.');
      return;
    }
    setErrors({});
    const yearNum = yearStarted.trim() ? parseInt(yearStarted, 10) : undefined;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaving(true);
    try {
      await upsertProfile({
        display_name:      emptyToUndefined(displayName),
        bio:               emptyToUndefined(bio),
        year_started:      yearNum,
        languages:         languages.length > 0 ? languages : undefined,
        highlights,
      });
      showSuccess('Profile & highlights saved.');
    } catch {
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeader
            title="Profile & highlights"
            subtitle="Configure your public profile and what shows first"
            back
          />

          {onboardingStep != null && <OnboardingProgress step={onboardingStep} />}

          {/* Public profile */}
          <Text style={styles.sectionLabel}>Public Profile</Text>
          <Text style={styles.sectionHelp}>
            Your photo, name and bio are the first things customers see. Fields marked * are required.
          </Text>
          <View style={styles.card}>
            {/* Profile photo */}
            <View style={styles.avatarRow}>
              <View style={styles.avatarWrap}>
                {profile?.cover_image_url ? (
                  <Image
                    source={{ uri: storageUrl(profile.cover_image_url) }}
                    style={styles.avatar}
                    contentFit="cover"
                    transition={150}
                  />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Ionicons name="person" size={40} color={palette.textDisabled} />
                  </View>
                )}
                <TouchableOpacity
                  style={styles.avatarEditBtn}
                  onPress={handleUploadCover}
                  disabled={uploadingCover}
                >
                  {uploadingCover
                    ? <ActivityIndicator size={12} color="#fff" />
                    : <Ionicons name="camera" size={14} color="#fff" />
                  }
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.avatarHint}>Profile photo</Text>
                <Text style={styles.avatarSub}>
                  Tap the camera icon to upload. Square crops work best.
                </Text>
              </View>
            </View>

            <View>
              <TextInput
                mode="outlined"
                label="Display name *"
                placeholder="What customers see (can differ from your legal name)"
                value={displayName}
                onChangeText={(text) => { setDisplayName(text); clearErr('displayName'); }}
                error={!!errors.displayName}
                style={styles.input}
                outlineStyle={styles.inputOutline}
                left={<TextInput.Icon icon="account-outline" />}
              />
              {errors.displayName && <Text style={styles.fieldError}>{errors.displayName}</Text>}
            </View>
            <View>
              <TextInput
                mode="outlined"
                label="Bio *"
                placeholder="Tell customers what you do and why they should book you..."
                value={bio}
                onChangeText={(text) => { setBio(text.slice(0, 500)); clearErr('bio'); }}
                multiline
                numberOfLines={4}
                error={!!(errors.bio || bioErr)}
                style={[styles.input, styles.bioInput]}
                outlineStyle={styles.inputOutline}
              />
              <Text style={styles.charCount}>
                {bioTrimmed < BIO_MIN ? `${bioTrimmed}/${BIO_MIN} for a strong bio` : `${bio.length}/500`}
              </Text>
              {(errors.bio || bioErr) ? (
                <Text style={styles.fieldError}>{errors.bio ?? bioErr}</Text>
              ) : bioWeak ? (
                <Text style={styles.fieldHint}>
                  {BIO_MIN - bioTrimmed} more character{BIO_MIN - bioTrimmed === 1 ? '' : 's'} makes your profile stronger in search.
                </Text>
              ) : null}
            </View>
            <View>
              <TextInput
                mode="outlined"
                label="Year you started"
                placeholder="e.g. 2019"
                value={yearStarted}
                onChangeText={(text) => { setYearStarted(text.replace(/[^0-9]/g, '').slice(0, 4)); clearErr('year'); }}
                keyboardType="number-pad"
                error={!!errors.year}
                style={styles.input}
                outlineStyle={styles.inputOutline}
                left={<TextInput.Icon icon="calendar-outline" />}
              />
              {errors.year && <Text style={styles.fieldError}>{errors.year}</Text>}
            </View>
          </View>

          {/* Languages */}
          <Text style={styles.sectionLabel}>Languages spoken (up to 4)</Text>
          <View style={[styles.card, styles.chipWrap]}>
            {LANGUAGE_CODES.map((code) => {
              const active = languages.includes(code);
              return (
                <TouchableRipple
                  key={code}
                  onPress={() => toggleLanguage(code)}
                  borderless
                  style={[styles.pickChip, active && styles.pickChipActive]}
                >
                  <Text style={[styles.pickChipText, active && styles.pickChipTextActive]}>
                    {LANGUAGE_LABELS[code]}
                  </Text>
                </TouchableRipple>
              );
            })}
          </View>


          {/* Portfolio manager (§5.3 — max 12 images / 5MB each) */}
          <View style={styles.sectionRowBetween}>
            <Text style={styles.sectionLabel}>Portfolio</Text>
            <Text style={styles.sectionHint}>{portfolioImages.length}/12</Text>
          </View>
          <View style={[styles.card, styles.photoGrid]}>
            {portfolioImages.map((path) => (
              <View key={path} style={styles.photoCell}>
                <Image source={{ uri: storageUrl(path) }} style={styles.photoImage} contentFit="cover" transition={150} />
                <TouchableOpacity
                  style={styles.photoDeleteBtn}
                  onPress={() => confirmRemovePhoto(path)}
                  disabled={deletingPath === path}
                >
                  <Ionicons name={deletingPath === path ? 'ellipsis-horizontal' : 'trash'} size={13} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
            {portfolioImages.length < 12 && (
              <TouchableOpacity style={styles.photoAddTile} onPress={handleAddPhoto} disabled={uploadingPhoto}>
                <Ionicons name={uploadingPhoto ? 'cloud-upload-outline' : 'camera-outline'} size={24} color={palette.textDisabled} />
                <Text style={styles.photoAddText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Certifications — coming soon (no verification pipeline yet) */}
          <Text style={styles.sectionLabel}>Certifications</Text>
          <View style={[styles.card, styles.comingSoonCard]}>
            <Ionicons name="ribbon-outline" size={22} color={palette.textDisabled} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Coming soon</Text>
              <Text style={styles.cardBody}>
                Adding certifications that trigger verification is on its way. We’ll notify you when it’s ready.
              </Text>
            </View>
          </View>

          {/* Highlights — pinned services */}
          <Text style={styles.sectionLabel}>Highlights — pinned services (up to 6)</Text>
          <View style={styles.card}>
            {highlights.pinned_service_ids.length > 0 && (
              <View style={styles.pinnedList}>
                {highlights.pinned_service_ids.map((id, index) => {
                  const svc = myServices.find((s) => s.id === id);
                  return (
                    <View key={id} style={styles.pinnedRow}>
                      <Ionicons name="pricetag-outline" size={16} color={palette.primary} />
                      <Text style={styles.pinnedText} numberOfLines={1}>{svc?.title ?? 'Service'}</Text>
                      <View style={styles.reorderActions}>
                        <TouchableRipple onPress={() => movePinnedService(index, -1)} disabled={index === 0} borderless style={styles.reorderBtn}>
                          <Ionicons name="chevron-up" size={15} color={index === 0 ? palette.textDisabled : palette.textSecondary} />
                        </TouchableRipple>
                        <TouchableRipple
                          onPress={() => movePinnedService(index, 1)}
                          disabled={index === highlights.pinned_service_ids.length - 1}
                          borderless style={styles.reorderBtn}
                        >
                          <Ionicons name="chevron-down" size={15} color={index === highlights.pinned_service_ids.length - 1 ? palette.textDisabled : palette.textSecondary} />
                        </TouchableRipple>
                        <TouchableRipple onPress={() => togglePinnedService(id)} borderless style={styles.reorderBtn}>
                          <Ionicons name="close" size={15} color={palette.danger} />
                        </TouchableRipple>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            {activeServices.length === 0 ? (
              <Text style={styles.cardBody}>List a service to be able to pin it to your profile.</Text>
            ) : (
              <View style={styles.chipWrap}>
                {activeServices.map((svc) => {
                  const pinned = highlights.pinned_service_ids.includes(svc.id);
                  return (
                    <TouchableRipple
                      key={svc.id}
                      onPress={() => togglePinnedService(svc.id)}
                      borderless
                      style={[styles.pickChip, pinned && styles.pickChipActive]}
                    >
                      <Text style={[styles.pickChipText, pinned && styles.pickChipTextActive]} numberOfLines={1}>
                        {pinned ? '✓ ' : ''}{svc.title}
                      </Text>
                    </TouchableRipple>
                  );
                })}
              </View>
            )}
          </View>

          {/* Highlights — featured photos */}
          <Text style={styles.sectionLabel}>Highlights — featured photos (up to 6)</Text>
          <View style={[styles.card, styles.photoGrid]}>
            {portfolioImages.length === 0 ? (
              <Text style={styles.cardBody}>Add portfolio images above to feature your best work first.</Text>
            ) : (
              portfolioImages.map((path) => {
                const featured = highlights.featured_photo_keys.includes(path);
                return (
                  <TouchableOpacity key={path} style={styles.photoCell} onPress={() => toggleFeaturedPhoto(path)} activeOpacity={0.85}>
                    <Image source={{ uri: storageUrl(path) }} style={styles.photoImage} contentFit="cover" transition={150} />
                    {featured && (
                      <View style={styles.photoFeaturedBadge}>
                        <Ionicons name="star" size={12} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {/* Highlights — featured badges */}
          <Text style={styles.sectionLabel}>Highlights — featured badges (up to 6)</Text>
          <View style={[styles.card, styles.chipWrap]}>
            {earnedBadges.length === 0 ? (
              <Text style={styles.cardBody}>You haven’t earned any badges yet — keep growing your business to unlock them.</Text>
            ) : (
              earnedBadges.map((key) => {
                const meta = EARNED_BADGE_META[key];
                if (!meta) return null;
                const active = highlights.featured_badges.includes(key);
                return (
                  <TouchableRipple
                    key={key}
                    onPress={() => toggleFeaturedBadge(key)}
                    borderless
                    style={[styles.badgePickChip, { borderColor: meta.color }, active && { backgroundColor: meta.color }]}
                  >
                    <View style={styles.badgePickInner}>
                      <Ionicons name={meta.icon} size={13} color={active ? '#fff' : meta.color} />
                      <Text style={[styles.badgePickText, { color: active ? '#fff' : meta.color }]}>{meta.label}</Text>
                    </View>
                  </TouchableRipple>
                );
              })
            )}
          </View>

          <Button
            mode="contained"
            onPress={handleSave}
            loading={saving}
            disabled={saving}
            style={styles.cta}
            contentStyle={styles.ctaContent}
          >
            Save changes
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.lg },
  backBtn: {
    width: 36, height: 36, borderRadius: r.full, marginTop: 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border,
  },
  headerText: { flex: 1 },
  pageTitle: { ...typography.heading3, color: palette.textPrimary },
  subtitle:  { ...typography.bodySmall, color: palette.textSecondary, marginTop: 2 },

  sectionLabel: { ...typography.label, color: palette.textSecondary, marginBottom: spacing.sm, marginTop: spacing.xs },
  sectionHelp: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12, lineHeight: 17, marginTop: -spacing.xs, marginBottom: spacing.sm },
  sectionRowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
  sectionHint: { ...typography.bodySmall, color: palette.textDisabled, fontSize: 12 },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  cardTitle: { ...typography.label, color: palette.textPrimary, marginBottom: 2 },
  cardBody:  { ...typography.bodySmall, color: palette.textSecondary, lineHeight: 18 },

  // Profile photo avatar
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatarWrap: { position: 'relative', width: 76, height: 76 },
  avatar: { width: 76, height: 76, borderRadius: 38 },
  avatarPlaceholder: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: palette.background,
    borderWidth: 1.5, borderColor: palette.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarEditBtn: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: palette.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: palette.surface,
  },
  avatarHint: { ...typography.label, color: palette.textPrimary, marginBottom: 2 },
  avatarSub:  { ...typography.bodySmall, color: palette.textSecondary, lineHeight: 17 },

  input: { backgroundColor: '#FFFFFF' },
  inputOutline: { borderRadius: r.sm },
  bioInput: { minHeight: 100 },
  charCount: { ...typography.bodySmall, color: palette.textDisabled, fontSize: 11, textAlign: 'right', marginTop: 2 },
  fieldError: { ...typography.bodySmall, color: palette.danger, fontSize: 12, marginTop: 2 },
  fieldHint:  { ...typography.bodySmall, color: palette.warning, fontSize: 12, marginTop: 2 },

  // Pick chips (languages, pinned services)
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pickChip: {
    borderRadius: r.full, borderWidth: 1.5, borderColor: palette.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    maxWidth: '100%',
  },
  pickChipActive: { backgroundColor: palette.primary, borderColor: palette.primary },
  pickChipText: { ...typography.bodySmall, color: palette.textSecondary },
  pickChipTextActive: { color: '#FFFFFF', fontFamily: 'DMSans_600SemiBold' },

  // Radius stepper
  radiusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepBtn: {
    width: 40, height: 40, borderRadius: r.full,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.primaryLight,
  },
  radiusValueWrap: { alignItems: 'center' },
  radiusValue: { ...typography.heading3, color: palette.textPrimary },
  radiusHint:  { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },

  // Portfolio / featured photo grid
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: PHOTO_GAP },
  photoCell: {
    width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: r.sm,
    overflow: 'hidden', backgroundColor: palette.background,
  },
  photoImage: { width: '100%', height: '100%' },
  photoDeleteBtn: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: r.full,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  photoFeaturedBadge: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: r.full,
    backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center',
  },
  photoAddTile: {
    width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: r.sm,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: palette.border,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  photoAddText: { ...typography.bodySmall, color: palette.textDisabled, fontSize: 11 },

  // Coming soon
  comingSoonCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  // Pinned services reorder list
  pinnedList: { gap: spacing.xs },
  pinnedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pinnedText: { ...typography.bodySmall, color: palette.textPrimary, flex: 1 },
  reorderActions: { flexDirection: 'row' },
  reorderBtn: { width: 28, height: 28, borderRadius: r.full, alignItems: 'center', justifyContent: 'center' },

  // Featured badge picker
  badgePickChip: { borderRadius: r.full, borderWidth: 1.5, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  badgePickInner: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  badgePickText: { ...typography.label, fontSize: 11.5 },

  cta: { borderRadius: r.sm, marginTop: spacing.sm },
  ctaContent: { height: 54 },
});
