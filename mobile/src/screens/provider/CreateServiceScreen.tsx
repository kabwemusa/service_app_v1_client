import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Button,
  HelperText,
  SegmentedButtons,
  Switch,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocationPickerSheet } from '../../components/location/LocationPickerSheet';
import { MarkdownEditor } from '../../components/ui/MarkdownEditor';
import { locationApi } from '../../api/location';
import {
  CommissionPreview,
  PricingModel,
  Service,
  ServiceStatus,
  servicesApi,
} from '../../api/services';
import { DeliveryLocation } from '../../store/locationStore';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useCategoryStore } from '../../store/categoryStore';
import { useServiceStore } from '../../store/serviceStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

const PRICING_OPTIONS: { value: PricingModel; label: string }[] = [
  { value: 'FIXED',  label: 'Fixed'    },
  { value: 'HOURLY', label: 'Hourly'   },
  { value: 'QUOTE',  label: 'By quote' },
];

interface DraftAddon { name: string; price: string }

export default function CreateServiceScreen({ navigation, route }: any) {
  const editing: Service | undefined = route.params?.service;
  const isEdit = !!editing;
  const insets = useSafeAreaInsets();

  const { categories, fetchCategories } = useCategoryStore();
  const { loading, error, createService, updateService, clearError } = useServiceStore();
  const { showSuccess, showError } = useSnackbar();

  const [categoryId, setCategoryId]     = useState<number | undefined>(editing?.category_id);
  const [title, setTitle]               = useState(editing?.title ?? '');
  const [description, setDescription]   = useState(editing?.description ?? '');
  const [pricingModel, setPricingModel] = useState<PricingModel>(editing?.pricing_model ?? 'FIXED');
  const [price, setPrice]               = useState(editing?.base_price != null ? String(editing.base_price) : '');
  const [duration, setDuration]         = useState(
    editing?.duration_estimate_mins != null ? String(editing.duration_estimate_mins) : ''
  );
  const [status, setStatus] = useState<ServiceStatus>(editing?.status ?? 'DRAFT');

  // §5.2 — "What's included" bullets, ordered (add/remove/reorder land in one save)
  const [inclusions, setInclusions]         = useState<string[]>(editing?.inclusions ?? []);
  const [inclusionDraft, setInclusionDraft] = useState('');

  // §5.3 — paid extras: name + price, ordered
  const [addons, setAddons] = useState<DraftAddon[]>(
    (editing?.addons ?? []).map((a) => ({ name: a.name, price: String(a.price) }))
  );
  const [addonName, setAddonName]   = useState('');
  const [addonPrice, setAddonPrice] = useState('');

  // §4.1/§4.2 — service location: resolved label only, never raw coordinates in the UI.
  const [location, setLocation]           = useState<DeliveryLocation | null>(null);
  const [locationLabel, setLocationLabel]  = useState<string | null>(null);
  const [pickerVisible, setPickerVisible]  = useState(false);

  // §6.7 — live commission preview, debounced as the provider edits price/category
  const [preview, setPreview]               = useState<CommissionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { fetchCategories(); }, []);

  // Reverse-geocode the existing service's coordinates into a display label —
  // §4.1 forbids ever rendering raw lat/lng, even for a service the provider owns.
  useEffect(() => {
    if (!isEdit || editing?.latitude == null || editing?.longitude == null) return;
    let cancelled = false;
    (async () => {
      try {
        const place = await locationApi.reverse(editing.latitude!, editing.longitude!);
        if (cancelled) return;
        setLocation({ lat: place.lat, lng: place.lng, label: place.label, region: place.region, source: 'SAVED' });
        setLocationLabel(place.label);
      } catch {
        if (cancelled) return;
        setLocation({ lat: editing.latitude!, lng: editing.longitude!, label: 'Current service location', region: null, source: 'SAVED' });
        setLocationLabel('Current service location');
      }
    })();
    return () => { cancelled = true; };
  }, [isEdit]);

  useEffect(() => {
    if (error && !error.isValidation) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const titleErr    = error?.isValidation ? error.fieldError('title')                  : null;
  const catErr      = error?.isValidation ? error.fieldError('category_id')            : null;
  const priceErr    = error?.isValidation ? error.fieldError('base_price')             : null;
  const durationErr = error?.isValidation ? error.fieldError('duration_estimate_mins') : null;
  const latErr      = error?.isValidation ? error.fieldError('latitude')               : null;

  // ── Live commission preview (§6.7 — "At {price}, {category}/{tier} commission
  //    is {rate}. You keep ~{net}.") — debounced so it doesn't fire on every keystroke
  useEffect(() => {
    if (previewDebounce.current) clearTimeout(previewDebounce.current);

    if (pricingModel === 'QUOTE' || !categoryId) {
      setPreview(null);
      return;
    }
    const numeric = parseFloat(price);
    if (Number.isNaN(numeric) || numeric <= 0) {
      setPreview(null);
      return;
    }

    previewDebounce.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const result = await servicesApi.commissionPreview(categoryId, numeric);
        setPreview(result);
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 450);

    return () => { if (previewDebounce.current) clearTimeout(previewDebounce.current); };
  }, [categoryId, price, pricingModel]);

  // ── Inclusions ─────────────────────────────────────────────────────────────
  const addInclusion = () => {
    const text = inclusionDraft.trim();
    if (!text) return;
    if (inclusions.length >= 20) { showError('You can list up to 20 inclusions.'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInclusions((prev) => [...prev, text]);
    setInclusionDraft('');
  };
  const removeInclusion = (index: number) => {
    Haptics.selectionAsync();
    setInclusions((prev) => prev.filter((_, i) => i !== index));
  };
  const moveInclusion = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= inclusions.length) return;
    Haptics.selectionAsync();
    setInclusions((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // ── Add-ons ────────────────────────────────────────────────────────────────
  const addAddon = () => {
    const name = addonName.trim();
    const priceNum = parseFloat(addonPrice);
    if (!name) { showError('Give the add-on a name.'); return; }
    if (Number.isNaN(priceNum) || priceNum < 0) { showError('Enter a valid add-on price.'); return; }
    if (addons.length >= 20) { showError('You can list up to 20 add-ons.'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAddons((prev) => [...prev, { name, price: addonPrice }]);
    setAddonName('');
    setAddonPrice('');
  };
  const removeAddon = (index: number) => {
    Haptics.selectionAsync();
    setAddons((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Location ───────────────────────────────────────────────────────────────
  const handleLocationSelect = useCallback((loc: DeliveryLocation) => {
    setLocation(loc);
    setLocationLabel(loc.label);
  }, []);

  // ── Publish / pause toggle (§6.7 — operates on `status`) ───────────────────
  const published = status === 'ACTIVE';
  const togglePublished = (value: boolean) => {
    Haptics.selectionAsync();
    setStatus(value ? 'ACTIVE' : (status === 'DRAFT' ? 'DRAFT' : 'PAUSED'));
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!categoryId) { showError('Please select a category.'); return; }
    if (!title.trim()) { showError('Give your service a title.'); return; }
    if (!location) { showError('Set where you offer this service before saving.'); return; }

    let numericPrice: number | null = null;
    if (pricingModel !== 'QUOTE') {
      numericPrice = parseFloat(price);
      if (Number.isNaN(numericPrice) || numericPrice <= 0) {
        showError(pricingModel === 'HOURLY' ? 'Enter your hourly rate.' : 'Enter a price.');
        return;
      }
    }

    const durationMins = duration.trim() ? parseInt(duration, 10) : null;
    if (duration.trim() && (Number.isNaN(durationMins!) || durationMins! < 1)) {
      showError('Estimated duration should be a whole number of minutes.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const payload = {
        category_id:             categoryId,
        title:                   title.trim(),
        description:             description.trim() || undefined,
        pricing_model:           pricingModel,
        base_price:              pricingModel === 'QUOTE' ? null : numericPrice,
        duration_estimate_mins:  durationMins,
        status,
        latitude:                location.lat,
        longitude:               location.lng,
        inclusions,
        addons: addons.map((a) => ({ name: a.name.trim(), price: parseFloat(a.price) || 0 })),
      };
      if (isEdit) {
        await updateService(editing!.id, payload);
        showSuccess('Service updated.');
      } else {
        await createService(payload);
        showSuccess(status === 'ACTIVE' ? 'Service published.' : 'Service saved as a draft.');
      }
      navigation.goBack();
    } catch {}
  };

  const priceLabel = pricingModel === 'HOURLY' ? 'Hourly rate (ZMW)' : 'Price (ZMW)';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <TouchableRipple onPress={() => navigation.goBack()} borderless style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={palette.textPrimary} />
            </TouchableRipple>
            <View style={styles.headerText}>
              <Text style={styles.title}>{isEdit ? 'Edit Service' : 'New Service'}</Text>
              <Text style={styles.subtitle}>Set details clearly so customers can book faster.</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
            {categories.map((category) => (
              <TouchableRipple
                key={category.id}
                onPress={() => { Haptics.selectionAsync(); setCategoryId(category.id); }}
                borderless
                style={[styles.catChip, categoryId === category.id && styles.catChipActive]}
              >
                <Text style={[styles.catChipText, categoryId === category.id && styles.catChipTextActive]}>
                  {category.name}
                </Text>
              </TouchableRipple>
            ))}
          </ScrollView>
          {catErr && <HelperText type="error" visible style={styles.helperTop}>{catErr}</HelperText>}

          <Text style={styles.sectionLabel}>Details</Text>
          <View style={styles.card}>
            <View>
              <TextInput
                mode="outlined"
                label="Service Title"
                placeholder="e.g. Physics Tutoring (UNZA)"
                value={title}
                onChangeText={setTitle}
                error={!!titleErr}
                style={styles.input}
                outlineStyle={styles.inputOutline}
              />
              {titleErr && <HelperText type="error" visible>{titleErr}</HelperText>}
            </View>

            <MarkdownEditor
              label="Description (optional)"
              placeholder="Describe what you offer — use bullets, bold, etc."
              value={description}
              onChangeText={setDescription}
            />
          </View>

          {/* ── Pricing model (§5.1/§6.7) ───────────────────────────────── */}
          <Text style={styles.sectionLabel}>How do you price this?</Text>
          <View style={styles.card}>
            <SegmentedButtons
              value={pricingModel}
              onValueChange={(v) => { Haptics.selectionAsync(); setPricingModel(v as PricingModel); }}
              buttons={PRICING_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />

            {pricingModel === 'QUOTE' ? (
              <Text style={styles.quoteHint}>
                Customers will see “By quote” and request a custom price from you instead of a listed rate.
              </Text>
            ) : (
              <>
                <View>
                  <TextInput
                    mode="outlined"
                    label={priceLabel}
                    keyboardType="decimal-pad"
                    value={price}
                    onChangeText={setPrice}
                    error={!!priceErr}
                    style={styles.input}
                    outlineStyle={styles.inputOutline}
                    left={<TextInput.Icon icon="cash" />}
                    right={pricingModel === 'HOURLY' ? <TextInput.Affix text="/ hr" /> : undefined}
                  />
                  {priceErr && <HelperText type="error" visible>{priceErr}</HelperText>}
                </View>

                <View>
                  <TextInput
                    mode="outlined"
                    label="Estimated duration (minutes, optional)"
                    keyboardType="number-pad"
                    value={duration}
                    onChangeText={setDuration}
                    error={!!durationErr}
                    style={styles.input}
                    outlineStyle={styles.inputOutline}
                    left={<TextInput.Icon icon="clock-outline" />}
                  />
                  {durationErr && <HelperText type="error" visible>{durationErr}</HelperText>}
                </View>
              </>
            )}

            {/* Live commission preview — "At {price}, {category}/{tier} commission is {rate}. You keep ~{net}." */}
            {pricingModel !== 'QUOTE' && (preview || previewLoading) && (
              <View style={styles.previewBox}>
                <Ionicons name="information-circle-outline" size={16} color={palette.primary} />
                {previewLoading && !preview ? (
                  <Text style={styles.previewText}>Calculating your commission…</Text>
                ) : preview ? (
                  <Text style={styles.previewText}>
                    At ZMW {preview.gross.toFixed(0)}, {categories.find((c) => c.id === categoryId)?.name ?? 'this category'}/Tier {preview.tier} commission is {(preview.effective_rate * 100).toFixed(1)}%. You keep ~ZMW {preview.net_to_provider.toFixed(0)}.
                  </Text>
                ) : null}
              </View>
            )}
          </View>

          {/* ── What's included (§5.2) ──────────────────────────────────── */}
          <Text style={styles.sectionLabel}>What's included</Text>
          <View style={styles.card}>
            {inclusions.map((item, index) => (
              <View key={`${item}-${index}`} style={styles.listRow}>
                <Ionicons name="checkmark-circle-outline" size={18} color={palette.success} />
                <Text style={styles.listText} numberOfLines={2}>{item}</Text>
                <View style={styles.listActions}>
                  <TouchableRipple
                    onPress={() => moveInclusion(index, -1)}
                    disabled={index === 0}
                    borderless
                    style={styles.listActionBtn}
                  >
                    <Ionicons name="chevron-up" size={16} color={index === 0 ? palette.textDisabled : palette.textSecondary} />
                  </TouchableRipple>
                  <TouchableRipple
                    onPress={() => moveInclusion(index, 1)}
                    disabled={index === inclusions.length - 1}
                    borderless
                    style={styles.listActionBtn}
                  >
                    <Ionicons name="chevron-down" size={16} color={index === inclusions.length - 1 ? palette.textDisabled : palette.textSecondary} />
                  </TouchableRipple>
                  <TouchableRipple onPress={() => removeInclusion(index)} borderless style={styles.listActionBtn}>
                    <Ionicons name="close" size={16} color={palette.danger} />
                  </TouchableRipple>
                </View>
              </View>
            ))}

            <View style={styles.addRow}>
              <TextInput
                mode="outlined"
                placeholder="e.g. Free pickup & drop-off"
                value={inclusionDraft}
                onChangeText={setInclusionDraft}
                onSubmitEditing={addInclusion}
                returnKeyType="done"
                style={[styles.input, styles.addInput]}
                outlineStyle={styles.inputOutline}
                dense
              />
              <TouchableRipple onPress={addInclusion} borderless style={styles.addBtn}>
                <Ionicons name="add" size={20} color="#FFFFFF" />
              </TouchableRipple>
            </View>
          </View>

          {/* ── Add-ons (§5.3) ──────────────────────────────────────────── */}
          <Text style={styles.sectionLabel}>Add-ons (optional extras)</Text>
          <View style={styles.card}>
            {addons.map((addon, index) => (
              <View key={`${addon.name}-${index}`} style={styles.listRow}>
                <Ionicons name="add-circle-outline" size={18} color={palette.primary} />
                <Text style={styles.listText} numberOfLines={1}>{addon.name}</Text>
                <Text style={styles.addonPrice}>ZMW {(parseFloat(addon.price) || 0).toFixed(0)}</Text>
                <TouchableRipple onPress={() => removeAddon(index)} borderless style={styles.listActionBtn}>
                  <Ionicons name="close" size={16} color={palette.danger} />
                </TouchableRipple>
              </View>
            ))}

            <View style={styles.addRow}>
              <TextInput
                mode="outlined"
                placeholder="Add-on name"
                value={addonName}
                onChangeText={setAddonName}
                style={[styles.input, styles.addInput]}
                outlineStyle={styles.inputOutline}
                dense
              />
              <TextInput
                mode="outlined"
                placeholder="Price"
                keyboardType="decimal-pad"
                value={addonPrice}
                onChangeText={setAddonPrice}
                onSubmitEditing={addAddon}
                returnKeyType="done"
                style={[styles.input, styles.addonPriceInput]}
                outlineStyle={styles.inputOutline}
                dense
              />
              <TouchableRipple onPress={addAddon} borderless style={styles.addBtn}>
                <Ionicons name="add" size={20} color="#FFFFFF" />
              </TouchableRipple>
            </View>
          </View>

          {/* ── Service location (§4.1/§4.2 — label only, never coordinates) ─ */}
          <Text style={styles.sectionLabel}>Where do you offer this from?</Text>
          <View style={styles.card}>
            <TouchableRipple
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPickerVisible(true); }}
              borderless
              style={styles.locationRow}
            >
              <View style={styles.locationRowInner}>
                <Ionicons name="location-outline" size={18} color={palette.primary} />
                <Text style={styles.locationText} numberOfLines={1}>
                  {locationLabel ?? 'Choose a location'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={palette.textSecondary} />
              </View>
            </TouchableRipple>
            {latErr && <HelperText type="error" visible>{latErr}</HelperText>}
          </View>

          {/* ── Photos ──────────────────────────────────────────────────── */}
          {isEdit && (
            <>
              <Text style={styles.sectionLabel}>Photos</Text>
              <TouchableRipple
                onPress={() => navigation.navigate('ServicePhotos', { serviceId: editing!.id, serviceTitle: editing!.title })}
                borderless
                style={styles.card}
              >
                <View style={styles.photoRow}>
                  <Ionicons name="images-outline" size={20} color={palette.primary} />
                  <Text style={styles.photoRowText}>Manage photos ({editing!.photos.length}/8)</Text>
                  <Ionicons name="chevron-forward" size={16} color={palette.textSecondary} />
                </View>
              </TouchableRipple>
            </>
          )}

          {/* ── Publish / pause (§6.7) ──────────────────────────────────── */}
          <Text style={styles.sectionLabel}>Visibility</Text>
          <View style={[styles.card, styles.publishRow]}>
            <View style={styles.publishText}>
              <Text style={styles.publishTitle}>{published ? 'Published' : 'Not published'}</Text>
              <Text style={styles.publishSubtitle}>
                {published
                  ? 'Customers can find and book this service.'
                  : 'Hidden from search — switch on when you’re ready to go live.'}
              </Text>
            </View>
            <Switch value={published} onValueChange={togglePublished} color={palette.primary} />
          </View>

          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={loading}
            disabled={loading}
            style={styles.submitBtn}
            contentStyle={styles.submitBtnContent}
            labelStyle={styles.submitBtnLabel}
          >
            {isEdit ? 'Save Changes' : published ? 'Publish Service' : 'Save Service'}
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>

      <LocationPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handleLocationSelect}
        title="Where do you offer this from?"
      />
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
  title:    { ...typography.heading2, color: palette.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.bodySmall, color: palette.textSecondary },

  sectionLabel: { ...typography.label, color: palette.textSecondary, marginBottom: spacing.sm },
  helperTop:    { marginTop: -spacing.xs, marginBottom: spacing.sm },

  catRow: { gap: spacing.sm, paddingBottom: spacing.md },
  catChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: r.full,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  catChipActive:     { borderColor: palette.primary, backgroundColor: palette.primaryLight },
  catChipText:       { ...typography.bodySmall, color: palette.textSecondary },
  catChipTextActive: { color: palette.primary },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  input:       { backgroundColor: '#FFFFFF' },
  inputOutline:{ borderRadius: r.lg },

  quoteHint: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    backgroundColor: palette.primaryLight,
    borderRadius: r.md,
    padding: spacing.sm,
  },

  previewBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: palette.primaryLight,
    borderRadius: r.md,
    padding: spacing.sm,
  },
  previewText: { ...typography.bodySmall, color: palette.textPrimary, flex: 1, fontSize: 13, lineHeight: 18 },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  listText: { ...typography.body, color: palette.textPrimary, flex: 1, fontSize: 14 },
  listActions: { flexDirection: 'row', alignItems: 'center' },
  listActionBtn: {
    width: 28, height: 28, borderRadius: r.full,
    alignItems: 'center', justifyContent: 'center',
  },
  addonPrice: { ...typography.label, color: palette.primary, fontSize: 14 },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  addInput: { flex: 1 },
  addonPriceInput: { width: 100 },
  addBtn: {
    width: 44, height: 44, borderRadius: r.full,
    backgroundColor: palette.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  locationRow: { borderRadius: r.md },
  locationRowInner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  locationText: { ...typography.body, color: palette.textPrimary, flex: 1, fontSize: 15 },

  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  photoRowText: { ...typography.body, color: palette.textPrimary, flex: 1, fontSize: 15 },

  publishRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  publishText: { flex: 1, paddingRight: spacing.md, gap: 2 },
  publishTitle: { ...typography.label, color: palette.textPrimary, fontSize: 15 },
  publishSubtitle: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },

  submitBtn:        { borderRadius: r.lg },
  submitBtnContent: { height: 54 },
  submitBtnLabel:   { ...typography.label, fontSize: 16 },
});
