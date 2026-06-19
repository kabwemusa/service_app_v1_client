import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, HelperText, ProgressBar, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocationSearch } from '../../components/ui/LocationSearch';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useProfileStore } from '../../store/profileStore';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { palette, radius as r, spacing, typography } from '../../theme';

const MOMO_PROVIDERS = ['MTN', 'AIRTEL', 'ZAMTEL'] as const;
type MomoProvider = typeof MOMO_PROVIDERS[number];

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
type Day = typeof DAYS[number];
type DayWindow = { start: string; end: string };
type AvailMatrix = Partial<Record<Day, DayWindow[]>>;

const HOURS = Array.from({ length: 17 }, (_, i) => {
  const h = i + 6;
  return `${String(h).padStart(2, '0')}:00`;
});

export default function ProviderSetupScreen({ navigation }: any) {
  const { profile, loading, error, fetchProfile, upsertProfile, clearError } = useProfileStore();
  const { showSuccess, showError } = useSnackbar();
  const insets = useSafeAreaInsets();

  const [displayName, setDisplayName]   = useState('');
  const [bio, setBio]                   = useState('');
  const [nrcNumber, setNrcNumber]       = useState('');
  const [momoProvider, setMomoProvider] = useState<MomoProvider | ''>('');
  const [momoNumber, setMomoNumber]     = useState('');
  const [lat, setLat]                   = useState('');
  const [lng, setLng]                   = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [radius, setRadius]             = useState('5');
  const [availability, setAvailability] = useState<AvailMatrix>({});

  useEffect(() => { fetchProfile(); }, []);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? '');
    setBio(profile.bio ?? '');
    setNrcNumber(profile.nrc_number ?? '');
    setMomoProvider((profile.momo_provider ?? '') as MomoProvider | '');
    setMomoNumber(profile.momo_number ?? '');
    setLat(profile.base_location_lat?.toString() ?? '');
    setLng(profile.base_location_lng?.toString() ?? '');
    setRadius(profile.max_radius_km?.toString() ?? '5');
    setAvailability((profile.availability_matrix as AvailMatrix) ?? {});
  }, [profile?.user_id]);

  useEffect(() => {
    if (error && !error.isValidation) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  function toggleDay(day: Day) {
    setAvailability(prev =>
      prev[day]
        ? (({ [day]: _, ...rest }) => rest)(prev as Record<Day, DayWindow[]>)
        : { ...prev, [day]: [{ start: '08:00', end: '17:00' }] },
    );
  }

  function setDayTime(day: Day, field: 'start' | 'end', value: string) {
    setAvailability(prev => ({
      ...prev,
      [day]: [{ ...prev[day]![0], [field]: value }],
    }));
  }

  const nrcError = error?.isValidation ? error.fieldError('nrc_number') : null;
  const momoErr  = error?.isValidation ? error.fieldError('momo_number') : null;
  const latErr   = error?.isValidation ? error.fieldError('base_location_lat') : null;

  const handleSave = async () => {
    const parsedLat = lat ? parseFloat(lat) : undefined;
    const parsedLng = lng ? parseFloat(lng) : undefined;
    if ((parsedLat !== undefined && Number.isNaN(parsedLat)) || (parsedLng !== undefined && Number.isNaN(parsedLng))) {
      showError('Invalid location. Please search or use GPS again.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await upsertProfile({
        display_name:       displayName || undefined,
        bio:                bio || undefined,
        nrc_number:         nrcNumber || undefined,
        momo_provider:      (momoProvider as MomoProvider) || undefined,
        momo_number:        momoNumber || undefined,
        base_location_lat:  parsedLat,
        base_location_lng:  parsedLng,
        max_radius_km:      radius ? parseInt(radius, 10) : undefined,
        availability_matrix: Object.keys(availability).length > 0 ? availability : undefined,
      });
      showSuccess('Profile saved successfully.');
    } catch {}
  };

  const completeness = profile?.profile_completeness ?? 0;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeader
            title="Provider profile"
            subtitle="Set trust details so clients can book confidently"
            back
          />

          <View style={styles.progressSection}>
            <View style={styles.progressRow}>
              <Text style={styles.progressLabel}>Profile completeness</Text>
              <Text style={styles.progressValue}>{completeness}%</Text>
            </View>
            <ProgressBar
              progress={completeness / 100}
              color={completeness === 100 ? palette.success : palette.primary}
              style={styles.progressBar}
            />
            {completeness < 100 && (
              <Text style={styles.progressHint}>
                Complete your profile to improve visibility in search results.
              </Text>
            )}
          </View>

          {profile && (
            <View style={[
              styles.kycBadge,
              profile.kyc_status === 'VERIFIED' && styles.kycVerified,
              profile.kyc_status === 'REJECTED' && styles.kycRejected,
            ]}>
              <Ionicons
                name={profile.kyc_status === 'VERIFIED' ? 'checkmark-circle' : 'time-outline'}
                size={16}
                color={
                  profile.kyc_status === 'VERIFIED' ? palette.success
                  : profile.kyc_status === 'REJECTED' ? palette.danger
                  : palette.warning
                }
              />
              <Text style={styles.kycText}>KYC: {profile.kyc_status}</Text>
            </View>
          )}

          <Text style={styles.sectionLabel}>Public Profile</Text>
          <View style={styles.card}>
            <TextInput
              mode="outlined"
              label="Display Name"
              placeholder="e.g. Kaunda Mwanza"
              value={displayName}
              onChangeText={setDisplayName}
              style={styles.input}
              outlineStyle={styles.inputOutline}
              left={<TextInput.Icon icon="account-outline" />}
            />
            <TextInput
              mode="outlined"
              label="Bio (optional)"
              placeholder="Tell customers about yourself..."
              value={bio}
              onChangeText={setBio}
              multiline
              numberOfLines={3}
              style={[styles.input, styles.bioInput]}
              outlineStyle={styles.inputOutline}
            />
          </View>

          <Text style={styles.sectionLabel}>Identity</Text>
          <View style={styles.card}>
            <View>
              <TextInput
                mode="outlined"
                label="NRC Number"
                placeholder="e.g. 123456/78/9"
                value={nrcNumber}
                onChangeText={setNrcNumber}
                error={!!nrcError}
                style={styles.input}
                outlineStyle={styles.inputOutline}
                left={<TextInput.Icon icon="card-account-details-outline" />}
              />
              {nrcError && <HelperText type="error" visible>{nrcError}</HelperText>}
            </View>
          </View>

          <Text style={styles.sectionLabel}>Mobile Money</Text>
          <View style={styles.card}>
            <View style={styles.momoRow}>
              {MOMO_PROVIDERS.map((provider) => (
                <TouchableRipple
                  key={provider}
                  onPress={() => { Haptics.selectionAsync(); setMomoProvider(provider); }}
                  borderless
                  style={[styles.momoBtn, momoProvider === provider && styles.momoBtnActive]}
                >
                  <Text style={[styles.momoBtnText, momoProvider === provider && styles.momoBtnTextActive]}>
                    {provider}
                  </Text>
                </TouchableRipple>
              ))}
            </View>
            <View>
              <TextInput
                mode="outlined"
                label="MoMo Number"
                placeholder="e.g. 0977123456"
                keyboardType="phone-pad"
                value={momoNumber}
                onChangeText={setMomoNumber}
                error={!!momoErr}
                style={styles.input}
                outlineStyle={styles.inputOutline}
                left={<TextInput.Icon icon="cellphone" />}
              />
              {momoErr && <HelperText type="error" visible>{momoErr}</HelperText>}
            </View>
          </View>

          <Text style={styles.sectionLabel}>Service Area</Text>
          <View style={styles.card}>
            <LocationSearch
              value={lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng), label: locationLabel, region: null, source: 'SEARCH' } : null}
              onChange={(loc) => {
                setLat(loc ? String(loc.lat) : '');
                setLng(loc ? String(loc.lng) : '');
                setLocationLabel(loc?.label ?? '');
              }}
              error={latErr}
            />
            <TextInput
              mode="outlined"
              label="Max Radius (km)"
              keyboardType="number-pad"
              value={radius}
              onChangeText={setRadius}
              style={styles.input}
              outlineStyle={styles.inputOutline}
              left={<TextInput.Icon icon="map-marker-radius-outline" />}
            />
          </View>

          <Text style={styles.sectionLabel}>Availability</Text>
          <View style={styles.card}>
            <Text style={styles.availHint}>Select the days and hours you are available for bookings.</Text>
            {DAYS.map((day) => {
              const active = !!availability[day];
              const window = availability[day]?.[0];
              return (
                <View key={day} style={styles.dayRow}>
                  <TouchableRipple
                    borderless
                    onPress={() => toggleDay(day)}
                    style={[styles.dayChip, active && styles.dayChipActive]}
                  >
                    <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>{day}</Text>
                  </TouchableRipple>

                  {active && window ? (
                    <View style={styles.timeRow}>
                      <View style={styles.timePickerGroup}>
                        <Text style={styles.timeLabel}>From</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hourList}>
                          {HOURS.slice(0, -1).map((h) => (
                            <TouchableRipple
                              key={h}
                              borderless
                              onPress={() => setDayTime(day, 'start', h)}
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
                          {HOURS.slice(1).map((h) => (
                            <TouchableRipple
                              key={h}
                              borderless
                              onPress={() => setDayTime(day, 'end', h)}
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

          <Button
            mode="contained"
            onPress={handleSave}
            loading={loading}
            disabled={loading}
            style={styles.saveBtn}
            contentStyle={styles.saveBtnContent}
            labelStyle={styles.saveBtnLabel}
          >
            Save Profile
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: r.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  headerText: { flex: 1 },
  pageTitle: { ...typography.heading2, color: palette.textPrimary, marginBottom: 2 },
  subtitle:  { ...typography.bodySmall, color: palette.textSecondary },

  progressSection: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  progressRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  progressLabel:{ ...typography.label, color: palette.textSecondary },
  progressValue:{ ...typography.label, color: palette.textPrimary },
  progressBar:  { height: 9, borderRadius: r.full },
  progressHint: { ...typography.bodySmall, color: palette.textSecondary, marginTop: spacing.xs },

  kycBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: palette.warningLight,
    borderRadius: r.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.lg,
  },
  kycVerified: { backgroundColor: palette.successLight },
  kycRejected: { backgroundColor: palette.dangerLight },
  kycText: { ...typography.bodySmall, color: palette.textPrimary },

  sectionLabel: { ...typography.label, color: palette.textSecondary, marginBottom: spacing.sm },
  card: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  input:       { backgroundColor: '#FFFFFF' },
  inputOutline:{ borderRadius: r.sm },
  bioInput:    { minHeight: 88 },

  momoRow: { flexDirection: 'row', gap: spacing.sm },
  momoBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: r.sm,
    borderWidth: 1.5,
    borderColor: palette.border,
    alignItems: 'center',
  },
  momoBtnActive:     { borderColor: palette.primary, backgroundColor: palette.primaryLight },
  momoBtnText:       { ...typography.label, color: palette.textSecondary },
  momoBtnTextActive: { color: palette.primary },

  saveBtn:        { borderRadius: r.sm, marginTop: spacing.md },
  saveBtnContent: { height: 54 },
  saveBtnLabel:   { ...typography.label, fontSize: 16 },

  availHint: { ...typography.bodySmall, color: palette.textSecondary, marginBottom: spacing.sm },
  dayRow:    { gap: spacing.xs, marginBottom: spacing.sm },
  dayChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: r.md,
    borderWidth: 1.5,
    borderColor: palette.border,
    alignSelf: 'flex-start',
  },
  dayChipActive:     { borderColor: palette.primary, backgroundColor: palette.primaryLight },
  dayChipText:       { ...typography.label, color: palette.textSecondary, fontSize: 13 },
  dayChipTextActive: { color: palette.primary },
  timeRow:           { gap: spacing.xs },
  timePickerGroup:   { gap: 4 },
  timeLabel:         { ...typography.bodySmall, color: palette.textSecondary, marginLeft: 2 },
  hourList:          { gap: 6, paddingVertical: 2 },
  hourChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  hourChipActive:     { borderColor: palette.primary, backgroundColor: palette.primary },
  hourChipText:       { ...typography.bodySmall, color: palette.textPrimary, fontSize: 12 },
  hourChipTextActive: { color: '#fff' },
});
