import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useBookingStore } from '../../store/bookingStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

// ── Types ──────────────────────────────────────────────────────────────────

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

function toISO(d: Date): string {
  return d.toISOString();
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-ZM', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function next14Days(): Date[] {
  const days: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

function placeLabel(result: NominatimResult): string {
  const parts = result.display_name.split(',').map((p) => p.trim());
  return parts[0];
}

function placeSub(result: NominatimResult): string {
  const parts = result.display_name.split(',').map((p) => p.trim());
  return parts.slice(1, 3).join(', ');
}

async function searchNominatim(query: string): Promise<NominatimResult[]> {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SebenzaStudentMarketplace/1.0' },
  });
  if (!res.ok) return [];
  return res.json();
}

async function reverseGeocode(lat: number, lon: number): Promise<NominatimResult | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse` +
    `?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SebenzaStudentMarketplace/1.0' },
  });
  if (!res.ok) return null;
  return res.json();
}

const HOUR_OPTIONS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const DURATION_OPTIONS = [1, 1.5, 2, 3, 4];

// ── Screen ─────────────────────────────────────────────────────────────────

export default function BookingScreen({ navigation, route }: any) {
  const serviceId: string    = route.params?.serviceId;
  const serviceTitle: string = route.params?.serviceTitle ?? 'Service';
  const basePrice: number    = route.params?.basePrice ?? 0;

  const insets = useSafeAreaInsets();
  const { showError } = useSnackbar();
  const { createBooking, submitting, error, clearError } = useBookingStore();

  const days = next14Days();
  const [selectedDay, setSelectedDay] = useState<Date>(days[0]);
  const [startHour, setStartHour]     = useState<number>(9);
  const [durationHrs, setDurationHrs] = useState<number>(1);

  // Location state
  const [locationQuery, setLocationQuery]     = useState('');
  const [suggestions, setSuggestions]         = useState<NominatimResult[]>([]);
  const [selectedPlace, setSelectedPlace]     = useState<NominatimResult | null>(null);
  const [locSearching, setLocSearching]       = useState(false);
  const [locGpsLoading, setLocGpsLoading]     = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  function handleLocationInput(text: string) {
    setLocationQuery(text);
    setSelectedPlace(null);
    setSuggestions([]);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.trim().length < 3) return;

    debounceRef.current = setTimeout(async () => {
      setLocSearching(true);
      try {
        const results = await searchNominatim(text.trim());
        setSuggestions(results);
      } catch {
        // silently ignore search errors
      } finally {
        setLocSearching(false);
      }
    }, 500);
  }

  function handleSelectSuggestion(place: NominatimResult) {
    setSelectedPlace(place);
    setLocationQuery(placeLabel(place));
    setSuggestions([]);
  }

  function handleClearLocation() {
    setSelectedPlace(null);
    setLocationQuery('');
    setSuggestions([]);
  }

  async function handleUseMyLocation() {
    setLocGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showError('Location permission denied.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = loc.coords;
      const result = await reverseGeocode(latitude, longitude);
      if (result) {
        setSelectedPlace(result);
        setLocationQuery(placeLabel(result));
      } else {
        // Fallback: store raw coords as a synthetic result
        const synthetic: NominatimResult = {
          place_id: 0,
          display_name: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          lat: String(latitude),
          lon: String(longitude),
        };
        setSelectedPlace(synthetic);
        setLocationQuery(synthetic.display_name);
      }
      setSuggestions([]);
    } catch {
      showError('Could not get your location. Try again.');
    } finally {
      setLocGpsLoading(false);
    }
  }

  async function handleSubmit() {
    if (!selectedPlace) {
      showError('Please set a delivery location first.');
      return;
    }

    const start = new Date(selectedDay);
    start.setHours(startHour, 0, 0, 0);

    const end = new Date(start);
    end.setMinutes(end.getMinutes() + Math.round(durationHrs * 60));

    try {
      const booking = await createBooking({
        service_id:      serviceId,
        scheduled_start: toISO(start),
        scheduled_end:   toISO(end),
        delivery_lat:    parseFloat(selectedPlace.lat),
        delivery_lng:    parseFloat(selectedPlace.lon),
      });
      navigation.replace('BookingDetail', { bookingId: booking.id });
    } catch {
      // error shown via effect
    }
  }

  const endHour = startHour + durationHrs;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableRipple onPress={() => navigation.goBack()} borderless style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={palette.textPrimary} />
        </TouchableRipple>
        <Text style={styles.navTitle}>Book service</Text>
        <View style={styles.backBtnPlaceholder} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Service summary */}
        <View style={styles.serviceCard}>
          <Text style={styles.serviceTitle}>{serviceTitle}</Text>
          <Text style={styles.servicePrice}>ZMW {basePrice.toFixed(2)}</Text>
        </View>

        {/* Date picker */}
        <Text style={styles.sectionLabel}>Select a date</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayRow}
        >
          {days.map((day, i) => {
            const isSelected = day.toDateString() === selectedDay.toDateString();
            return (
              <TouchableOpacity
                key={i}
                style={[styles.dayChip, isSelected && styles.dayChipActive]}
                onPress={() => setSelectedDay(day)}
              >
                <Text style={[styles.dayChipWeekday, isSelected && styles.dayChipTextActive]}>
                  {day.toLocaleDateString('en', { weekday: 'short' })}
                </Text>
                <Text style={[styles.dayChipNum, isSelected && styles.dayChipTextActive]}>
                  {day.getDate()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Start time */}
        <Text style={styles.sectionLabel}>Start time</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.timeRow}
        >
          {HOUR_OPTIONS.map((h) => {
            const active = h === startHour;
            return (
              <TouchableOpacity
                key={h}
                style={[styles.timeChip, active && styles.timeChipActive]}
                onPress={() => setStartHour(h)}
              >
                <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>
                  {pad(h)}:00
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Duration */}
        <Text style={styles.sectionLabel}>Duration</Text>
        <View style={styles.durationRow}>
          {DURATION_OPTIONS.map((d) => {
            const label = d === 1 ? '1 hr' : `${d} hrs`;
            const active = d === durationHrs;
            return (
              <TouchableOpacity
                key={d}
                style={[styles.durationChip, active && styles.durationChipActive]}
                onPress={() => setDurationHrs(d)}
              >
                <Text style={[styles.durationText, active && styles.durationTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Summary row */}
        <View style={styles.summaryCard}>
          <Ionicons name="time-outline" size={16} color={palette.textSecondary} />
          <Text style={styles.summaryText}>
            {fmtDate(selectedDay)}
            {'  '}
            {pad(startHour)}:00 – {pad(Math.floor(endHour))}:{endHour % 1 ? '30' : '00'}
          </Text>
        </View>

        {/* Delivery location */}
        <Text style={styles.sectionLabel}>Delivery location</Text>
        <View style={styles.locationCard}>
          {/* Search row */}
          <View style={styles.locationInputRow}>
            <Ionicons
              name={selectedPlace ? 'checkmark-circle' : 'search-outline'}
              size={18}
              color={selectedPlace ? palette.success : palette.textSecondary}
              style={{ marginRight: spacing.xs }}
            />
            <TextInput
              style={styles.locationInput}
              placeholder="Search for a place…"
              placeholderTextColor={palette.textDisabled}
              value={locationQuery}
              onChangeText={handleLocationInput}
              autoCorrect={false}
            />
            {locSearching && (
              <ActivityIndicator size="small" color={palette.primary} style={{ marginLeft: spacing.xs }} />
            )}
            {locationQuery.length > 0 && !locSearching && (
              <TouchableOpacity onPress={handleClearLocation} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={18} color={palette.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Suggestions dropdown */}
          {suggestions.length > 0 && (
            <View style={styles.suggestionsBox}>
              {suggestions.map((s) => (
                <TouchableOpacity
                  key={s.place_id}
                  style={styles.suggestionRow}
                  onPress={() => handleSelectSuggestion(s)}
                >
                  <Ionicons name="location-outline" size={14} color={palette.textSecondary} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1, marginLeft: spacing.xs }}>
                    <Text style={styles.suggestionMain} numberOfLines={1}>{placeLabel(s)}</Text>
                    <Text style={styles.suggestionSub} numberOfLines={1}>{placeSub(s)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* GPS button */}
          <TouchableOpacity
            style={styles.gpsBtn}
            onPress={handleUseMyLocation}
            disabled={locGpsLoading}
          >
            {locGpsLoading ? (
              <ActivityIndicator size="small" color={palette.primary} />
            ) : (
              <Ionicons name="navigate-outline" size={16} color={palette.primary} />
            )}
            <Text style={styles.gpsBtnText}>Use my current location</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Sticky footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Button
          mode="contained"
          style={styles.bookBtn}
          contentStyle={styles.bookBtnContent}
          labelStyle={styles.bookBtnLabel}
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitting || !selectedPlace}
        >
          Confirm Booking
        </Button>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: r.full,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.border,
  },
  backBtnPlaceholder: { width: 36 },
  navTitle: { ...typography.label, color: palette.textSecondary },

  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },

  serviceCard: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...shadow.card,
  },
  serviceTitle: { ...typography.label, color: palette.textPrimary, flex: 1 },
  servicePrice: { ...typography.label, color: palette.primary },

  sectionLabel: {
    ...typography.label,
    color: palette.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },

  dayRow: { gap: spacing.sm, paddingBottom: spacing.xs },
  dayChip: {
    width: 52, paddingVertical: spacing.sm,
    borderRadius: r.md,
    borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: 'center',
  },
  dayChipActive: { backgroundColor: palette.primary, borderColor: palette.primary },
  dayChipWeekday: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 11 },
  dayChipNum: { ...typography.label, color: palette.textPrimary, fontSize: 16 },
  dayChipTextActive: { color: '#fff' },

  timeRow: { gap: spacing.sm, paddingBottom: spacing.xs },
  timeChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: r.md,
    borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  timeChipActive: { backgroundColor: palette.primary, borderColor: palette.primary },
  timeChipText: { ...typography.bodySmall, color: palette.textPrimary },
  timeChipTextActive: { color: '#fff' },

  durationRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  durationChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: r.md,
    borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  durationChipActive: { backgroundColor: palette.primaryLight, borderColor: palette.primary },
  durationText: { ...typography.bodySmall, color: palette.textPrimary },
  durationTextActive: { color: palette.primary },

  summaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: r.md, borderWidth: 1, borderColor: palette.border,
    padding: spacing.sm,
  },
  summaryText: { ...typography.bodySmall, color: palette.textSecondary },

  // Location
  locationCard: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    ...shadow.card,
  },
  locationInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: r.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: palette.background,
  },
  locationInput: {
    flex: 1,
    ...typography.body,
    color: palette.textPrimary,
    paddingVertical: 0,
  },

  suggestionsBox: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: r.md,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  suggestionMain: { ...typography.bodySmall, color: palette.textPrimary, fontWeight: '600' },
  suggestionSub:  { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },

  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
  gpsBtnText: { ...typography.bodySmall, color: palette.primary },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: palette.background,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  bookBtn: { borderRadius: r.lg },
  bookBtnContent: { height: 54 },
  bookBtnLabel: { ...typography.label, fontSize: 16 },
});
