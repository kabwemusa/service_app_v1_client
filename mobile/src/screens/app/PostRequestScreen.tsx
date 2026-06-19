import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../api/errors';
import { serviceRequestsApi } from '../../api/serviceRequests';
import { LocationPickerSheet } from '../../components/location/LocationPickerSheet';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useCategoryStore } from '../../store/categoryStore';
import { DeliveryLocation, toDeliveryLocation, useLocationStore } from '../../store/locationStore';
import { palette, radius as r, spacing, typography } from '../../theme';

// v3.2 §6 — time-window presets: urgency is the whole point of this flow, so
// the choices are coarse and fast, not a datetime form.
const WINDOWS: { key: string; label: string; hint: string; start: () => Date; end: () => Date }[] = [
  {
    key: 'asap', label: 'ASAP', hint: 'Next few hours',
    start: () => new Date(Date.now() + 30 * 60_000),
    end:   () => new Date(Date.now() + 4 * 3_600_000),
  },
  {
    key: 'today', label: 'Later today', hint: 'Before end of day',
    start: () => new Date(Date.now() + 2 * 3_600_000),
    end:   () => { const d = new Date(); d.setHours(20, 0, 0, 0); return d.getTime() > Date.now() + 2 * 3_600_000 ? d : new Date(Date.now() + 6 * 3_600_000); },
  },
  {
    key: 'tomorrow_am', label: 'Tomorrow AM', hint: '08:00 – 12:00',
    start: () => { const d = new Date(Date.now() + 86_400_000); d.setHours(8, 0, 0, 0); return d; },
    end:   () => { const d = new Date(Date.now() + 86_400_000); d.setHours(12, 0, 0, 0); return d; },
  },
  {
    key: 'tomorrow_pm', label: 'Tomorrow PM', hint: '12:00 – 18:00',
    start: () => { const d = new Date(Date.now() + 86_400_000); d.setHours(12, 0, 0, 0); return d; },
    end:   () => { const d = new Date(Date.now() + 86_400_000); d.setHours(18, 0, 0, 0); return d; },
  },
];

export default function PostRequestScreen({ navigation, route }: any) {
  const initialCategoryId = route.params?.categoryId as number | undefined;

  const { categories, fetchCategories } = useCategoryStore();
  const { primaryLocation }             = useLocationStore();
  const { showSuccess, showError }      = useSnackbar();
  const insets = useSafeAreaInsets();

  const [categoryId, setCategoryId]   = useState<number | undefined>(initialCategoryId);
  const [description, setDescription] = useState('');
  const [windowKey, setWindowKey]     = useState('asap');
  const [budget, setBudget]           = useState('');
  const [location, setLocation]       = useState<DeliveryLocation | null>(
    primaryLocation ? toDeliveryLocation(primaryLocation) : null,
  );
  const [pickerVisible, setPickerVisible] = useState(false);
  const [submitting, setSubmitting]       = useState(false);

  useEffect(() => { fetchCategories(); }, []);

  const window = useMemo(() => WINDOWS.find((w) => w.key === windowKey)!, [windowKey]);
  const canSubmit = categoryId != null && description.trim().length >= 10 && location != null && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !location) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      const res = await serviceRequestsApi.post({
        category_id:     categoryId!,
        description:     description.trim(),
        delivery_lat:    location.lat,
        delivery_lng:    location.lng,
        delivery_label:  location.label ?? undefined,
        delivery_region: location.region ?? undefined,
        delivery_source: location.source,
        window_start:    window.start().toISOString(),
        window_end:      window.end().toISOString(),
        ...(budget.trim() !== '' && !isNaN(Number(budget)) ? { budget_zmw: Number(budget) } : {}),
      });
      showSuccess(
        res.notified_count > 0
          ? `Request sent to ${res.notified_count} nearby provider${res.notified_count === 1 ? '' : 's'} — replies land in your notifications.`
          : 'Request posted. We\'ll notify providers as they become available.',
      );
      navigation.goBack();
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Could not post your request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={22} color={palette.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Post a request</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.intro}>
            Tell nearby providers what you need — the best-matched ones get notified and reply
            with a price within 30 minutes.
          </Text>

          {/* 1. Category */}
          <Text style={styles.label}>What do you need?</Text>
          <View style={styles.chipWrap}>
            {categories.map((cat) => {
              const active = cat.id === categoryId;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => { Haptics.selectionAsync(); setCategoryId(cat.id); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{cat.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 2. Description */}
          <Text style={styles.label}>Describe the job</Text>
          <TextInput
            mode="outlined"
            multiline
            numberOfLines={4}
            maxLength={500}
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. Kitchen geyser is leaking from the valve — needs repair today."
            style={styles.textArea}
          />
          <Text style={styles.counter}>{description.trim().length}/500 · at least 10 characters</Text>

          {/* 3. Where */}
          <Text style={styles.label}>Where</Text>
          <TouchableOpacity
            style={styles.locationRow}
            onPress={() => setPickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Choose delivery location"
          >
            <Ionicons name="location-outline" size={18} color={palette.primary} />
            <Text style={styles.locationText} numberOfLines={1}>
              {location?.label ?? 'Choose a location'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
          </TouchableOpacity>

          {/* 4. When */}
          <Text style={styles.label}>When</Text>
          <View style={styles.chipWrap}>
            {WINDOWS.map((w) => {
              const active = w.key === windowKey;
              return (
                <TouchableOpacity
                  key={w.key}
                  style={[styles.windowChip, active && styles.chipActive]}
                  onPress={() => { Haptics.selectionAsync(); setWindowKey(w.key); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{w.label}</Text>
                  <Text style={[styles.windowHint, active && styles.chipTextActive]}>{w.hint}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 5. Budget (optional) */}
          <Text style={styles.label}>Budget (optional)</Text>
          <TextInput
            mode="outlined"
            keyboardType="numeric"
            value={budget}
            onChangeText={(t) => setBudget(t.replace(/[^0-9.]/g, ''))}
            placeholder="ZMW"
            left={<TextInput.Affix text="ZMW" />}
            style={styles.budgetInput}
          />
        </ScrollView>

        {/* Submit */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button
            mode="contained"
            onPress={handleSubmit}
            disabled={!canSubmit}
            loading={submitting}
            contentStyle={{ paddingVertical: 6 }}
            style={styles.submitBtn}
          >
            Notify nearby providers
          </Button>
        </View>
      </KeyboardAvoidingView>

      <LocationPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={(loc) => { setLocation(loc); setPickerVisible(false); }}
        title="Where is the job?"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: palette.background },
  scroll: { paddingHorizontal: spacing.lg },

  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: r.full,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { ...typography.heading3, color: palette.textPrimary },

  intro: { ...typography.bodySmall, color: palette.textSecondary, lineHeight: 20, marginBottom: spacing.md },

  label: { ...typography.label, color: palette.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderRadius: r.full, borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  windowChip: {
    borderRadius: r.sm, borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    minWidth: 100,
  },
  chipActive:     { backgroundColor: palette.primary, borderColor: palette.primary },
  chipText:       { ...typography.bodySmall, color: palette.textPrimary, fontSize: 13 },
  chipTextActive: { color: '#FFFFFF' },
  windowHint:     { ...typography.bodySmall, color: palette.textSecondary, fontSize: 10, marginTop: 2 },

  textArea: { backgroundColor: palette.surface, minHeight: 100 },
  counter:  { ...typography.bodySmall, color: palette.textDisabled, fontSize: 11, marginTop: 4 },

  locationRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderRadius: r.sm, borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: spacing.md, minHeight: 48,
  },
  locationText: { ...typography.body, color: palette.textPrimary, flex: 1, fontSize: 14 },

  budgetInput: { backgroundColor: palette.surface },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    backgroundColor: palette.background,
    borderTopWidth: 1, borderTopColor: palette.border,
  },
  submitBtn: { borderRadius: r.full },
});
