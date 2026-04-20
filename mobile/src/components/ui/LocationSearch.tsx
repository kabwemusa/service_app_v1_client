import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface Props {
  lat: string;
  lng: string;
  locationLabel: string;
  onLocationChange: (lat: string, lng: string, label: string) => void;
  latError?: string | null;
}

export function LocationSearch({ lat, lng, locationLabel, onLocationChange, latError }: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [selected, setSelected] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (locationLabel) setQuery(locationLabel);
  }, [locationLabel]);

  const search = (text: string) => {
    setQuery(text);
    setSelected(false);
    setSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 3) return;
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=5&addressdetails=0`;
        const res = await fetch(url, { headers: { 'User-Agent': 'SebenzaApp/1.0' } });
        const data: NominatimResult[] = await res.json();
        setSuggestions(data);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 500);
  };

  const pick = (item: NominatimResult) => {
    const label = item.display_name.split(',').slice(0, 3).join(',').trim();
    setQuery(label);
    setSuggestions([]);
    setSelected(true);
    onLocationChange(item.lat, item.lon, label);
  };

  const useGPS = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
        { headers: { 'User-Agent': 'SebenzaApp/1.0' } },
      );
      const data = await res.json();
      const label = data.display_name?.split(',').slice(0, 3).join(',').trim()
        ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      setQuery(label);
      setSuggestions([]);
      setSelected(true);
      onLocationChange(String(latitude), String(longitude), label);
    } catch {
      // silently fail
    } finally {
      setLocating(false);
    }
  };

  const clear = () => {
    setQuery('');
    setSuggestions([]);
    setSelected(false);
    onLocationChange('', '', '');
  };

  return (
    <View>
      <View style={styles.inputRow}>
        <View style={styles.inputWrap}>
          <Ionicons name="location-outline" size={18} color={palette.textSecondary} style={styles.inputIcon} />
          <TextInput
            mode="flat"
            placeholder="Search place or address..."
            value={query}
            onChangeText={search}
            style={styles.textInput}
            underlineStyle={{ display: 'none' } as any}
            dense
          />
          {searching && <ActivityIndicator size={14} color={palette.primary} style={styles.inputRight} />}
          {selected && !searching && (
            <Ionicons name="checkmark-circle" size={18} color={palette.success} style={styles.inputRight} />
          )}
          {query.length > 0 && !searching && !selected && (
            <TouchableOpacity onPress={clear} style={styles.inputRight}>
              <Ionicons name="close-circle" size={18} color={palette.textDisabled} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={useGPS} style={styles.gpsBtn} disabled={locating}>
          {locating
            ? <ActivityIndicator size={16} color={palette.primary} />
            : <Ionicons name="navigate" size={18} color={palette.primary} />
          }
        </TouchableOpacity>
      </View>

      {suggestions.length > 0 && (
        <View style={styles.dropdown}>
          <FlatList
            data={suggestions}
            keyExtractor={(s) => String(s.place_id)}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.suggestion} onPress={() => pick(item)}>
                <Ionicons name="location-outline" size={14} color={palette.textSecondary} />
                <Text style={styles.suggestionText} numberOfLines={2}>
                  {item.display_name}
                </Text>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
          />
        </View>
      )}

      {!!lat && !!lng && selected && (
        <Text style={styles.coords}>
          {parseFloat(lat).toFixed(5)}, {parseFloat(lng).toFixed(5)}
        </Text>
      )}
      {latError ? <Text style={styles.errorText}>{latError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.background,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.sm,
    height: 48,
  },
  inputIcon: { marginRight: 6 },
  textInput: {
    flex: 1,
    backgroundColor: 'transparent',
    fontSize: 14,
    paddingHorizontal: 0,
    height: 48,
  },
  inputRight: { marginLeft: 6 },
  gpsBtn: {
    width: 46,
    height: 46,
    borderRadius: r.lg,
    backgroundColor: palette.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdown: {
    marginTop: spacing.xs,
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
    ...shadow.card,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestionText: { ...typography.bodySmall, color: palette.textPrimary, flex: 1 },
  sep: { height: 1, backgroundColor: palette.border },
  coords: { ...typography.bodySmall, color: palette.textDisabled, marginTop: 4 },
  errorText: { ...typography.bodySmall, color: palette.danger, marginTop: 4 },
});
