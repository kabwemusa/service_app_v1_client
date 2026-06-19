import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { locationApi, PlaceCandidate } from '../../api/location';
import { useHighAccuracyLocation } from '../../hooks/useHighAccuracyLocation';
import { palette, radius as r, spacing, typography } from '../../theme';
import { SkeletonBlock } from './SkeletonBlock';

// ── Public types ─────────────────────────────────────────────────────────────

/** Shape produced by every selection in this component — label only shown in
 *  UI; lat/lng travel internally to PostGIS and are never rendered as numbers. */
export interface SelectedLocation {
  label:  string;
  lat:    number;
  lng:    number;
  region: string | null;
  source: 'DEVICE' | 'SEARCH';
}

interface Props {
  /** Currently selected location (pass null / undefined when nothing is chosen). */
  value?:   SelectedLocation | null;
  /** Called whenever the selection changes. Receives null on clear. */
  onChange: (loc: SelectedLocation | null) => void;
  /** Server-side validation error to show below the input. */
  error?:   string | null;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Landmark-first location picker for Zambian users.
 *
 * Search path: typed query → backend /location/search proxy → Nominatim
 * (countrycodes=zm, POI/establishment ranked first by the server-side layer).
 *
 * GPS path: useHighAccuracyLocation hook → Highest-accuracy fused fix with a
 * mandatory precision buffer → backend /location/reverse → human label.
 *
 * Coordinates are never shown to the user. The resolved SelectedLocation
 * carries lat/lng internally for the booking/PostGIS pipeline.
 */
export function LocationSearch({ value, onChange, error }: Props) {
  const [query,       setQuery]       = useState(value?.label ?? '');
  const [suggestions, setSuggestions] = useState<PlaceCandidate[]>([]);
  const [searching,   setSearching]   = useState(false);
  const [confirmed,   setConfirmed]   = useState(!!value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { loading: locating, error: gpsError, capture } = useHighAccuracyLocation();

  // Sync display text if the parent updates value externally (e.g. deep-link pre-fill)
  useEffect(() => {
    if (value?.label !== undefined && value.label !== query) {
      setQuery(value.label);
      setConfirmed(true);
    } else if (!value) {
      setQuery('');
      setConfirmed(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.label]);

  const handleQueryChange = (text: string) => {
    setQuery(text);
    setConfirmed(false);
    setSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) return;

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setSuggestions(await locationApi.search(text.trim()));
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 250);
  };

  const pick = (item: PlaceCandidate) => {
    setQuery(item.label);
    setSuggestions([]);
    setConfirmed(true);
    onChange({
      label:  item.label,
      lat:    item.lat,
      lng:    item.lng,
      region: item.region,
      source: 'SEARCH',
    });
  };

  const handleGPS = async () => {
    const candidate = await capture();
    if (candidate) {
      setQuery(candidate.label);
      setConfirmed(true);
      onChange({
        label:  candidate.label,
        lat:    candidate.lat,
        lng:    candidate.lng,
        region: candidate.region,
        source: 'DEVICE',
      });
    }
  };

  const clear = () => {
    setQuery('');
    setSuggestions([]);
    setConfirmed(false);
    onChange(null);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 72 : 0}
      style={styles.root}
    >
      <View style={styles.inputRow}>
        {/* While the precision buffer is running, replace the input with a
            skeleton so the user knows something is happening without seeing
            a flash of stale text. */}
        {locating ? (
          <View style={styles.skeletonWrap}>
            <SkeletonBlock width="100%" height={48} radius={r.lg} />
          </View>
        ) : (
          <View style={styles.inputWrap}>
            <Ionicons
              name="location-outline"
              size={18}
              color={palette.textSecondary}
              style={styles.inputIcon}
            />
            <TextInput
              mode="flat"
              placeholder="Search a place or landmark…"
              value={query}
              onChangeText={handleQueryChange}
              style={styles.textInput}
              underlineStyle={{ display: 'none' } as any}
              dense
            />
            {searching && (
              <ActivityIndicator
                size={14}
                color={palette.primary}
                style={styles.inputRight}
              />
            )}
            {confirmed && !searching && (
              <Ionicons
                name="checkmark-circle"
                size={18}
                color={palette.success}
                style={styles.inputRight}
              />
            )}
            {query.length > 0 && !searching && !confirmed && (
              <TouchableOpacity onPress={clear} style={styles.inputRight}>
                <Ionicons name="close-circle" size={18} color={palette.textDisabled} />
              </TouchableOpacity>
            )}
          </View>
        )}

        <TouchableOpacity
          onPress={handleGPS}
          style={[styles.gpsBtn, locating && styles.gpsBtnDisabled]}
          disabled={locating}
        >
          <Ionicons
            name="navigate"
            size={18}
            color={locating ? palette.textDisabled : palette.primary}
          />
        </TouchableOpacity>
      </View>

      {suggestions.length > 0 && (
        <View style={styles.dropdown}>
          {/* ScrollView avoids the VirtualizedList-inside-ScrollView warning that
              FlatList would trigger when LocationSearch is used inside a ScrollView
              screen (BookingSheet, ProviderSetupScreen). maxHeight caps growth so
              the list never pushes past the visible area above the keyboard. */}
          <ScrollView
            style={styles.dropdownList}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={suggestions.length > 3}
          >
            {suggestions.map((item, idx) => (
              <React.Fragment key={`${item.label}-${idx}`}>
                <TouchableOpacity style={styles.suggestion} onPress={() => pick(item)}>
                  <Ionicons name="location-outline" size={14} color={palette.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestionLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                    {!!item.region && (
                      <Text style={styles.suggestionRegion} numberOfLines={1}>
                        {item.region}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
                {idx < suggestions.length - 1 && <View style={styles.sep} />}
              </React.Fragment>
            ))}
          </ScrollView>
        </View>
      )}

      {!!gpsError && <Text style={styles.errorText}>{gpsError}</Text>}
      {!!error    && <Text style={styles.errorText}>{error}</Text>}
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    zIndex: 20,
    elevation: 20,
  },
  inputRow: {
    flexDirection: 'row',
    gap:           spacing.xs,
    alignItems:    'center',
  },
  skeletonWrap: {
    flex:   1,
    height: 48,
  },
  inputWrap: {
    flex:            1,
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: palette.background,
    borderRadius:    r.lg,
    borderWidth:     1,
    borderColor:     palette.border,
    paddingHorizontal: spacing.sm,
    height:          48,
  },
  inputIcon:  { marginRight: 6 },
  textInput: {
    flex:            1,
    backgroundColor: 'transparent',
    fontSize:        14,
    paddingHorizontal: 0,
    height:          48,
  },
  inputRight: { marginLeft: 6 },

  gpsBtn: {
    width:           46,
    height:          46,
    borderRadius:    r.lg,
    backgroundColor: palette.primaryLight,
    alignItems:      'center',
    justifyContent:  'center',
  },
  gpsBtnDisabled: {
    backgroundColor: palette.border,
  },

  dropdown: {
    marginTop:       spacing.xs,
    backgroundColor: palette.surface,
    borderRadius:    r.sm,
    borderWidth:     StyleSheet.hairlineWidth,
    borderColor:     palette.border,
    overflow:        'hidden',
    // Flat (v3.1 §2): no shadow. zIndex/elevation here are for Android stacking
    // ONLY (this autocomplete panel floats over content with no scrim) — the
    // hairline border + solid surface provide the visual separation.
    zIndex:          30,
    elevation:       30,
  },
  dropdownList: {
    maxHeight: 260,
  },
  suggestion: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    gap:            spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestionLabel:  { ...typography.bodySmall, color: palette.textPrimary, flex: 1 },
  suggestionRegion: { ...typography.bodySmall, color: palette.textSecondary, flex: 1, marginTop: 1 },
  sep:              { height: 1, backgroundColor: palette.border },

  errorText: { ...typography.bodySmall, color: palette.danger, marginTop: 4 },
});
