import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { locationApi, PlaceCandidate } from '../../api/location';
import { useHighAccuracyLocation } from '../../hooks/useHighAccuracyLocation';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useLocationStore } from '../../store/locationStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

/**
 * v3.1 §4.5-A — primary location capture, gated in before Home. Two entry points,
 * neither of which ever shows the user a coordinate: "Use my current location"
 * (device GPS → reverse-geocode → confirm the resolved label) and "Search for
 * a place" (autocomplete). Permission denial never blocks onboarding — it just
 * narrows the user to the search path.
 */
export default function LocationOnboardingScreen() {
  const [query, setQuery]             = useState('');
  const [suggestions, setSuggestions] = useState<PlaceCandidate[]>([]);
  const [searching, setSearching]     = useState(false);
  const [confirming, setConfirming]   = useState<{ candidate: PlaceCandidate; source: 'DEVICE' } | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { setPrimary, loading } = useLocationStore();
  const { showError } = useSnackbar();
  const { loading: locating, capture } = useHighAccuracyLocation();

  const saving = loading;

  // ── "Use my current location" ─────────────────────────────────────────────
  const handleUseCurrentLocation = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const candidate = await capture();
    if (candidate) {
      setConfirming({ candidate, source: 'DEVICE' });
    } else {
      setPermissionDenied(true);
      showError('Could not get your location — search for your area below instead.');
    }
  };

  // ── "Search for a place" ──────────────────────────────────────────────────
  const handleQueryChange = (text: string) => {
    setQuery(text);
    setSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await locationApi.search(text.trim());
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 450);
  };

  const handlePickSuggestion = async (candidate: PlaceCandidate) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSuggestions([]);
    setQuery(candidate.label);
    const ok = await setPrimary({
      lat:    candidate.lat,
      lng:    candidate.lng,
      label:  candidate.label,
      region: candidate.region,
      source: 'SEARCH',
    });
    if (!ok) showError('Could not save that location. Please try again.');
  };

  // ── GPS confirmation step ──────────────────────────────────────────────────
  const handleConfirmGps = async () => {
    if (!confirming) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { candidate } = confirming;
    const ok = await setPrimary({
      lat:    candidate.lat,
      lng:    candidate.lng,
      label:  candidate.label,
      region: candidate.region,
      source: 'DEVICE',
    });
    if (!ok) showError('Could not save that location. Please try again.');
  };

  const handleRejectGps = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setConfirming(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.iconBadge}>
              <Ionicons name="location" size={28} color={palette.primary} />
            </View>
            <Text style={styles.heading}>Where should we look for providers?</Text>
            <Text style={styles.subheading}>
              We'll show you trusted services near this place. Your exact location
              is never shown to anyone — only a place name like "Kabwata, Lusaka".
            </Text>
          </View>

          {confirming ? (
            <View style={styles.card}>
              <Text style={styles.confirmEyebrow}>Is this right?</Text>
              <View style={styles.confirmPlace}>
                <Ionicons name="location" size={20} color={palette.primary} />
                <View style={styles.flex}>
                  <Text style={styles.confirmLabel}>{confirming.candidate.label}</Text>
                  {!!confirming.candidate.region && (
                    <Text style={styles.confirmRegion}>{confirming.candidate.region}</Text>
                  )}
                </View>
              </View>

              <Button
                mode="contained"
                onPress={handleConfirmGps}
                loading={saving}
                disabled={saving}
                style={styles.btn}
                contentStyle={styles.btnContent}
                labelStyle={styles.btnLabel}
              >
                Yes, that's right
              </Button>
              <Button
                mode="text"
                onPress={handleRejectGps}
                disabled={saving}
                style={styles.btnSecondary}
                labelStyle={styles.btnSecondaryLabel}
              >
                Search for a different place
              </Button>
            </View>
          ) : (
            <View style={styles.card}>
              <Button
                mode="contained"
                icon={() => <Ionicons name="navigate" size={18} color="#FFFFFF" />}
                onPress={handleUseCurrentLocation}
                loading={locating}
                disabled={locating || saving}
                style={styles.btn}
                contentStyle={styles.btnContent}
                labelStyle={styles.btnLabel}
              >
                Use my current location
              </Button>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              <View style={styles.inputGroup}>
                <TextInput
                  mode="outlined"
                  label="Search for a place"
                  placeholder="e.g. Kabwata, Lusaka"
                  value={query}
                  onChangeText={handleQueryChange}
                  style={styles.input}
                  outlineStyle={styles.inputOutline}
                  left={<TextInput.Icon icon="magnify" />}
                  right={searching ? <TextInput.Icon icon={() => <ActivityIndicator size={16} color={palette.primary} />} /> : undefined}
                />
              </View>

              {suggestions.length > 0 && (
                <View style={styles.dropdown}>
                  <ScrollView
                    style={styles.dropdownList}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                  >
                    {suggestions.map((item, idx) => (
                      <React.Fragment key={`${item.label}-${idx}`}>
                      <TouchableOpacity style={styles.suggestion} onPress={() => handlePickSuggestion(item)}>
                        <Ionicons name="location-outline" size={16} color={palette.textSecondary} />
                        <View style={styles.flex}>
                          <Text style={styles.suggestionLabel} numberOfLines={1}>{item.label}</Text>
                          {!!item.region && (
                            <Text style={styles.suggestionRegion} numberOfLines={1}>{item.region}</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                        {idx < suggestions.length - 1 && <View style={styles.sep} />}
                      </React.Fragment>
                    ))}
                  </ScrollView>
                </View>
              )}

              {permissionDenied && (
                <Text style={styles.hint}>
                  Location permission was denied — search for your area above. You can
                  enable location access later from your device settings.
                </Text>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl + 40,
  },
  hero: {
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heading: {
    ...typography.heading1,
    fontSize: 26,
    lineHeight: 34,
    color: palette.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subheading: {
    ...typography.body,
    color: palette.textSecondary,
    textAlign: 'center',
    maxWidth: 340,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: palette.surface,
    borderRadius: r.xl,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  btn: { borderRadius: r.lg },
  btnContent: { height: 54 },
  btnLabel: { ...typography.label, fontSize: 16, letterSpacing: 0.2 },
  btnSecondary: { marginTop: spacing.xs },
  btnSecondaryLabel: { ...typography.label, color: palette.textSecondary },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.md, gap: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: palette.border },
  dividerText: { ...typography.bodySmall, color: palette.textDisabled },

  inputGroup: { marginBottom: spacing.xs },
  input: { backgroundColor: '#FFFFFF' },
  inputOutline: { borderRadius: r.lg },

  dropdown: {
    marginTop: spacing.xs,
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
  },
  dropdownList: {
    maxHeight: 240,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  suggestionLabel:  { ...typography.label, color: palette.textPrimary, fontSize: 14 },
  suggestionRegion: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },
  sep: { height: 1, backgroundColor: palette.border },

  hint: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },

  confirmEyebrow: {
    ...typography.label,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  confirmPlace: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: palette.primaryLight,
    borderRadius: r.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  confirmLabel:  { ...typography.heading3, fontSize: 17, color: palette.textPrimary },
  confirmRegion: { ...typography.bodySmall, color: palette.textSecondary, marginTop: 2 },
});
