import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { locationApi, PlaceCandidate } from '../../api/location';
import { useHighAccuracyLocation } from '../../hooks/useHighAccuracyLocation';
import { useSnackbar } from '../../providers/SnackbarProvider';
import {
  candidateToDeliveryLocation,
  DeliveryLocation,
  savedToDeliveryLocation,
  toDeliveryLocation,
  useLocationStore,
} from '../../store/locationStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

interface Props {
  visible:  boolean;
  onClose:  () => void;
  onSelect: (location: DeliveryLocation) => void;
  /** Sheet title — e.g. "Show providers near" or "Delivery location" (§4.5-B). */
  title?: string;
}

/**
 * v3.1 §4.5-B — the one delivery-location picker shared by Home (discovery anchor)
 * and the booking flow. Lets the user switch to: primary, current GPS location,
 * a saved place, or a place search — and always shows only the resolved `label`,
 * never coordinates.
 */
export function LocationPickerSheet({ visible, onClose, onSelect, title = 'Choose a location' }: Props) {
  const { primary, saved, savedLoaded, fetchSaved } = useLocationStore();
  const { showError } = useSnackbar();

  const [mode, setMode]               = useState<'list' | 'search'>('list');
  const [query, setQuery]             = useState('');
  const [suggestions, setSuggestions] = useState<PlaceCandidate[]>([]);
  const [searching, setSearching]     = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { loading: locating, capture } = useHighAccuracyLocation();

  useEffect(() => {
    if (visible) {
      setMode('list');
      setQuery('');
      setSuggestions([]);
      if (!savedLoaded) fetchSaved();
    }
  }, [visible]);

  const choose = (loc: DeliveryLocation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelect(loc);
    onClose();
  };

  const handleUseCurrentLocation = async () => {
    const candidate = await capture();
    if (candidate) {
      choose(candidateToDeliveryLocation(candidate, 'DEVICE'));
    } else {
      // gpsError state lags behind due to React's async batching — reading it
      // here would see the stale value. Treat any null return as a failure and
      // surface the message the hook already set via its own error state.
      showError('Could not determine your location. Try searching for a place instead.');
    }
  };

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
        setSuggestions(await locationApi.search(text.trim()));
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 450);
  };

  const savedPlaces = saved.filter((s) => !s.is_primary);

  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kav}
        >
        <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
          <View style={[styles.sheet, mode === 'search' && styles.sheetExpanded]}>
            <View style={styles.handle} />

            <View style={styles.header}>
              {mode === 'search' ? (
                <TouchableOpacity onPress={() => setMode('list')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="chevron-back" size={20} color={palette.textSecondary} />
                </TouchableOpacity>
              ) : (
                <View style={{ width: 20 }} />
              )}
              <Text style={styles.headerTitle}>{title}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color={palette.textSecondary} />
              </TouchableOpacity>
            </View>

            {mode === 'list' ? (
              <View style={styles.body}>
                {primary && (
                  <OptionRow
                    icon="home"
                    label={primary.label}
                    sub={primary.region ?? 'Primary location'}
                    badge="Primary"
                    onPress={() => choose(toDeliveryLocation(primary))}
                  />
                )}

                <OptionRow
                  icon="navigate"
                  label="Use current location"
                  sub="Resolve from device GPS"
                  loading={locating}
                  onPress={handleUseCurrentLocation}
                />

                {savedPlaces.map((s) => (
                  <OptionRow
                    key={s.id}
                    icon="bookmark"
                    label={s.label}
                    sub={s.place_name}
                    onPress={() => choose(savedToDeliveryLocation(s))}
                  />
                ))}

                <OptionRow
                  icon="search"
                  label="Search for a place"
                  sub="Find an address, landmark, or area"
                  onPress={() => setMode('search')}
                />
              </View>
            ) : (
              <View style={styles.searchBody}>
                <TextInput
                  mode="outlined"
                  placeholder="Search for a place…"
                  value={query}
                  onChangeText={handleQueryChange}
                  autoFocus
                  style={styles.input}
                  outlineStyle={styles.inputOutline}
                  left={<TextInput.Icon icon="magnify" />}
                  right={searching ? <TextInput.Icon icon={() => <ActivityIndicator size={16} color={palette.primary} />} /> : undefined}
                />

                <FlatList
                  data={suggestions}
                  keyExtractor={(item, idx) => `${item.label}-${idx}`}
                  keyboardShouldPersistTaps="handled"
                  style={styles.suggestionList}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.suggestion}
                      onPress={() => choose(candidateToDeliveryLocation(item, 'SEARCH'))}
                    >
                      <Ionicons name="location-outline" size={16} color={palette.textSecondary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestionLabel} numberOfLines={1}>{item.label}</Text>
                        {!!item.region && <Text style={styles.suggestionRegion} numberOfLines={1}>{item.region}</Text>}
                      </View>
                    </TouchableOpacity>
                  )}
                  ItemSeparatorComponent={() => <View style={styles.sep} />}
                  ListEmptyComponent={
                    query.trim().length >= 2 && !searching ? (
                      <Text style={styles.emptyText}>No places found. Try a different search.</Text>
                    ) : null
                  }
                />
              </View>
            )}
          </View>
        </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Option row ───────────────────────────────────────────────────────────────

interface OptionRowProps {
  icon:    React.ComponentProps<typeof Ionicons>['name'];
  label:   string;
  sub?:    string;
  badge?:  string;
  loading?: boolean;
  onPress: () => void;
}

function OptionRow({ icon, label, sub, badge, loading, onPress }: OptionRowProps) {
  return (
    <TouchableOpacity style={styles.option} onPress={onPress} disabled={loading}>
      <View style={styles.optionIcon}>
        {loading
          ? <ActivityIndicator size={16} color={palette.primary} />
          : <Ionicons name={icon} size={18} color={palette.primary} />
        }
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.optionLabel} numberOfLines={1}>{label}</Text>
        {!!sub && <Text style={styles.optionSub} numberOfLines={1}>{sub}</Text>}
      </View>
      {badge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root:     { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  kav:      { justifyContent: 'flex-end' },
  sheetWrap: { backgroundColor: palette.surface, borderTopLeftRadius: r.xl, borderTopRightRadius: r.xl },

  sheet: {
    backgroundColor:      palette.surface,
    borderTopLeftRadius:  r.xl,
    borderTopRightRadius: r.xl,
    maxHeight:            '80%',
    ...shadow.modal,
  },
  // In search mode the sheet must flex so the FlatList fills space above keyboard
  sheetExpanded: { flex: 1 },

  searchBody:     { flex: 1, padding: spacing.lg, gap: spacing.xs },
  suggestionList: { flex: 1 },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: r.full,
    backgroundColor: palette.border,
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  headerTitle: { ...typography.label, color: palette.textPrimary, fontSize: 16 },

  body: { padding: spacing.lg, gap: spacing.xs },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLabel: { ...typography.label, color: palette.textPrimary, fontSize: 15 },
  optionSub:   { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12, marginTop: 1 },
  badge: {
    backgroundColor: palette.primaryLight,
    borderRadius: r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeText: { ...typography.label, color: palette.primary, fontSize: 11 },

  input: { backgroundColor: '#FFFFFF', marginBottom: spacing.sm },
  inputOutline: { borderRadius: r.lg },

  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  suggestionLabel:  { ...typography.label, color: palette.textPrimary, fontSize: 14 },
  suggestionRegion: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },
  sep: { height: 1, backgroundColor: palette.border },
  emptyText: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
