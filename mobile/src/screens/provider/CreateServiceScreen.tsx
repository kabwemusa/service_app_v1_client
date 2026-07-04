import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput as RNTextInput,
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
import { storageUrl } from '../../api/client';
import { ApiError } from '../../api/errors';
import { locationApi } from '../../api/location';
import {
  CommissionPreview,
  PricingModel,
  Service,
  ServicePhoto,
  ServiceStatus,
  servicesApi,
} from '../../api/services';
import { LocationPickerSheet } from '../../components/location/LocationPickerSheet';
import { MarkdownEditor } from '../../components/ui/MarkdownEditor';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { OnboardingProgress } from '../../components/provider/OnboardingProgress';
import { TabItem, Tabs } from '../../components/ui/Tabs';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { DeliveryLocation } from '../../store/locationStore';
import { Category } from '../../api/categories';
import { useCategoryStore } from '../../store/categoryStore';
import { useProfileStore } from '../../store/profileStore';
import { useServiceStore } from '../../store/serviceStore';
import { palette, radius as r, spacing, typography } from '../../theme';
import { fontFamily } from '../../theme/typography';

type SectionKey = 'details' | 'pricing' | 'extras' | 'photos';

// Outcome-based pricing — the provider owns every price parameter; customers
// never input hours anywhere.
const PRICING_OPTIONS: { value: PricingModel; label: string; description: string }[] = [
  {
    value: 'OUTCOME_FIXED',
    label: 'Fixed outcome',
    description: 'One price for a defined outcome. Customers book and pay it upfront.',
  },
  {
    value: 'HOURLY_CAPPED',
    label: 'Hourly with a cap',
    description: 'Rate + minimum + spend cap. The cap is held; customers only pay for actual time.',
  },
  {
    value: 'PROVIDER_SCOPE',
    label: 'Quote after brief',
    description: 'Customers answer your questions; you send a fixed quote they approve before paying.',
  },
  {
    value: 'QUOTE_DEPOSIT',
    label: 'Quote + deposit',
    description: 'For large jobs: full quote after the brief, a deposit confirms, balance on completion.',
  },
];

// Legacy model names may still arrive from cached payloads — map them forward.
function normalizeModel(model: string | undefined): PricingModel {
  switch (model) {
    case 'FIXED':  return 'OUTCOME_FIXED';
    case 'HOURLY': return 'HOURLY_CAPPED';
    case 'QUOTE':  return 'PROVIDER_SCOPE';
    default:       return (model as PricingModel) ?? 'OUTCOME_FIXED';
  }
}

const STATUS_OPTIONS: { value: ServiceStatus; label: string }[] = [
  { value: 'DRAFT',  label: 'Draft'  },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
];

interface DraftAddon { name: string; price: string }

// Which fields, when missing, block which action — mapped to the tab that hides them.
interface FieldError { tab: SectionKey; field: string }

export default function CreateServiceScreen({ navigation, route }: any) {
  const editing: Service | undefined = route.params?.service;
  const onboardingStep: number | undefined = route.params?.onboardingStep;
  const isEdit = !!editing;
  const insets = useSafeAreaInsets();

  const { categories, fetchCategories } = useCategoryStore();
  const { loading, createService, updateService, clearError } = useServiceStore();
  const dashboardMode = useProfileStore((s) => s.dashboard?.payment_mode);
  const fetchDashboard = useProfileStore((s) => s.fetchDashboard);
  const dashboardLoaded = useProfileStore((s) => s.dashboard !== null);
  const { showSuccess, showError } = useSnackbar();

  // One source of truth for commission copy (§ commission rule): per-service mode
  // if known, else the platform dashboard mode, else the DIRECT pilot default.
  const paymentMode = editing?.payment_mode ?? dashboardMode ?? 'DIRECT';

  // ── One form, one dirty-state across every tab ──────────────────────────────
  const [section, setSection] = useState<SectionKey>('details');
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const markDirty = useCallback(() => setDirty(true), []);

  const [categoryId, setCategoryId]     = useState<number | undefined>(editing?.category_id);
  const [title, setTitle]               = useState(editing?.title ?? '');
  const [description, setDescription]   = useState(editing?.description ?? '');
  const [pricingModel, setPricingModel] = useState<PricingModel>(normalizeModel(editing?.pricing_model));
  const [price, setPrice]               = useState(editing?.base_price != null ? String(editing.base_price) : '');
  // HOURLY_CAPPED parameters — all provider-set, all required to publish.
  const [hourlyRate, setHourlyRate]     = useState(editing?.hourly_rate != null ? String(editing.hourly_rate) : '');
  const [minimumHours, setMinimumHours] = useState(editing?.minimum_hours != null ? String(editing.minimum_hours) : '1');
  const [capHours, setCapHours]         = useState(editing?.cap_hours != null ? String(editing.cap_hours) : '4');
  // QUOTE_DEPOSIT
  const [depositPercent, setDepositPercent] = useState(
    editing?.deposit_percent != null ? String(editing.deposit_percent) : '30'
  );
  // PROVIDER_SCOPE / QUOTE_DEPOSIT — structured brief questions for the customer.
  const [scopePrompts, setScopePrompts]         = useState<string[]>(editing?.scope_prompts ?? []);
  const [scopePromptDraft, setScopePromptDraft] = useState('');
  const [duration, setDuration]         = useState(
    editing?.duration_estimate_mins != null ? String(editing.duration_estimate_mins) : ''
  );
  const [status, setStatus]   = useState<ServiceStatus>(editing?.status ?? 'DRAFT');
  const [isPinned, setIsPinned] = useState(editing?.is_pinned ?? false);

  const [inclusions, setInclusions]         = useState<string[]>(editing?.inclusions ?? []);
  const [inclusionDraft, setInclusionDraft] = useState('');

  const [addons, setAddons] = useState<DraftAddon[]>(
    (editing?.addons ?? []).map((a) => ({ name: a.name, price: String(a.price) }))
  );
  const [addonName, setAddonName]   = useState('');
  const [addonPrice, setAddonPrice] = useState('');

  const [location, setLocation]          = useState<DeliveryLocation | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  // Photos are persisted immediately (need a service id), so they sit outside the
  // form dirty-state — discarding form edits never loses an uploaded photo.
  const [photos, setPhotos]       = useState<ServicePhoto[]>(editing?.photos ?? []);
  const [uploading, setUploading] = useState(false);
  const [busyPhotoId, setBusyPhotoId] = useState<number | null>(null);
  const [photoError, setPhotoError]   = useState<string | null>(null);

  // Publish-validation state — which tabs/fields are offending.
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);

  const [preview, setPreview]               = useState<CommissionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const titleRef = useRef<any>(null);
  const priceRef = useRef<any>(null);

  useEffect(() => {
    fetchCategories();
    if (!dashboardLoaded) fetchDashboard();
    clearError(); // drop any stale store error so it isn't shown by the list later
  }, []);

  // Refresh photos for an existing service (list payload may be stale).
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    servicesApi.show(editing!.id)
      .then((svc) => { if (!cancelled) setPhotos(svc.photos ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isEdit]);

  // Reverse-geocode existing coordinates into a label — §4.1 never renders raw lat/lng.
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

  // ── Discard guard — prompt before leaving with unsaved changes ──────────────
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e: any) => {
      if (!dirtyRef.current || savingRef.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', 'You have unsaved changes. Leave without saving?', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return sub;
  }, [navigation]);

  // The customer-facing "worst case" amount per model: outcome price, or the
  // hourly spend cap (rate × cap hours). Quote-first models have none yet.
  const previewBasis = pricingModel === 'OUTCOME_FIXED'
    ? parseFloat(price)
    : pricingModel === 'HOURLY_CAPPED'
      ? (parseFloat(hourlyRate) || 0) * (parseFloat(capHours) || 0)
      : NaN;

  // ── Live commission preview — only ESCROW mode charges commission ───────────
  useEffect(() => {
    if (previewDebounce.current) clearTimeout(previewDebounce.current);
    if (paymentMode !== 'ESCROW' || !categoryId) {
      setPreview(null);
      return;
    }
    const numeric = previewBasis;
    if (Number.isNaN(numeric) || numeric <= 0) { setPreview(null); return; }

    previewDebounce.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        setPreview(await servicesApi.commissionPreview(categoryId, numeric));
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 450);
    return () => { if (previewDebounce.current) clearTimeout(previewDebounce.current); };
  }, [categoryId, price, hourlyRate, capHours, pricingModel, paymentMode]);

  // ── Scope prompts (brief questions) ─────────────────────────────────────────
  const addScopePrompt = () => {
    const text = scopePromptDraft.trim();
    if (!text) return;
    if (scopePrompts.length >= 8) { showError('You can ask up to 8 questions.'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setScopePrompts((prev) => [...prev, text]);
    setScopePromptDraft('');
    markDirty();
  };
  const removeScopePrompt = (index: number) => {
    Haptics.selectionAsync();
    setScopePrompts((prev) => prev.filter((_, i) => i !== index));
    markDirty();
  };

  // ── Inclusions ──────────────────────────────────────────────────────────────
  const addInclusion = () => {
    const text = inclusionDraft.trim();
    if (!text) return;
    if (inclusions.length >= 20) { showError('You can list up to 20 inclusions.'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInclusions((prev) => [...prev, text]);
    setInclusionDraft('');
    markDirty();
  };
  const removeInclusion = (index: number) => {
    Haptics.selectionAsync();
    setInclusions((prev) => prev.filter((_, i) => i !== index));
    markDirty();
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
    markDirty();
  };

  // ── Add-ons ─────────────────────────────────────────────────────────────────
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
    markDirty();
  };
  const removeAddon = (index: number) => {
    Haptics.selectionAsync();
    setAddons((prev) => prev.filter((_, i) => i !== index));
    markDirty();
  };

  const handleLocationSelect = useCallback((loc: DeliveryLocation) => {
    setLocation(loc);
    setLocationLabel(loc.label);
    markDirty();
  }, [markDirty]);

  // ── Photos (persisted immediately; run server-side §5.3 pipeline) ───────────
  const addPhoto = async () => {
    setPhotoError(null);
    if (photos.length >= 8) { setPhotoError('Maximum 8 photos per service.'); return; }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') { showError('Photo library permission is required.'); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.8,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const formData = new FormData();
    formData.append('photo', { uri: asset.uri, name: `photo_${Date.now()}.jpg`, type: 'image/jpeg' } as any);

    setUploading(true);
    try {
      const photo = await servicesApi.uploadPhoto(editing!.id, formData);
      setPhotos((prev) => [...prev, photo]);
      showSuccess('Photo added.');
    } catch (e) {
      // Pipeline rejections (NSFW / duplicate / oversize) surface inline.
      setPhotoError(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const deletePhoto = (photo: ServicePhoto) => {
    Alert.alert('Remove photo', 'Delete this photo from your service?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusyPhotoId(photo.id);
          try {
            await servicesApi.deletePhoto(editing!.id, photo.id);
            setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
          } catch (e) {
            showError(e instanceof ApiError ? e.message : 'Failed to delete photo.');
          } finally {
            setBusyPhotoId(null);
          }
        },
      },
    ]);
  };

  // Reorder (first = cover). No gesture lib installed — move left/right controls.
  const movePhoto = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= photos.length) return;
    const prev = photos;
    const next = [...photos];
    [next[index], next[target]] = [next[target], next[index]];
    Haptics.selectionAsync();
    setPhotos(next);
    try {
      await servicesApi.reorderPhotos(editing!.id, next.map((p) => p.id));
    } catch (e) {
      setPhotos(prev);
      showError(e instanceof ApiError ? e.message : 'Could not reorder photos.');
    }
  };

  // ── Validation ──────────────────────────────────────────────────────────────
  const hasError = (field: string) => fieldErrors.some((e) => e.field === field);
  const tabHasError = (tab: SectionKey) => fieldErrors.some((e) => e.tab === tab);

  const collectErrors = (forStatus: ServiceStatus): FieldError[] => {
    const errs: FieldError[] = [];
    // Required to save at all (backend also enforces these).
    if (!title.trim())   errs.push({ tab: 'details', field: 'title' });
    if (!categoryId)     errs.push({ tab: 'details', field: 'category' });
    // Location is optional — when left blank it defaults to the provider's base
    // location (set once in your profile). Providers can still override per service.
    // Required only to publish (move to ACTIVE).
    if (forStatus === 'ACTIVE') {
      if (pricingModel === 'OUTCOME_FIXED' && !(parseFloat(price) > 0)) {
        errs.push({ tab: 'pricing', field: 'price' });
      }
      if (pricingModel === 'HOURLY_CAPPED') {
        const rate = parseFloat(hourlyRate);
        const min  = parseFloat(minimumHours);
        const cap  = parseFloat(capHours);
        if (!(rate > 0)) errs.push({ tab: 'pricing', field: 'hourly_rate' });
        if (!(min > 0))  errs.push({ tab: 'pricing', field: 'minimum_hours' });
        // No uncapped hourly: the cap is required and must cover the minimum.
        if (!(cap > 0) || (min > 0 && cap < min)) errs.push({ tab: 'pricing', field: 'cap_hours' });
      }
      if (pricingModel === 'PROVIDER_SCOPE' && !(parseFloat(hourlyRate) > 0)) {
        errs.push({ tab: 'pricing', field: 'hourly_rate' });
      }
      if (pricingModel === 'QUOTE_DEPOSIT') {
        const pct = parseInt(depositPercent, 10);
        if (!(pct >= 10 && pct <= 90)) errs.push({ tab: 'pricing', field: 'deposit_percent' });
      }
      if (inclusions.length === 0) errs.push({ tab: 'extras', field: 'inclusions' });
    }
    return errs;
  };

  const focusFirst = (errs: FieldError[]) => {
    const first = errs[0];
    setSection(first.tab);
    setTimeout(() => {
      if (first.field === 'title') titleRef.current?.focus?.();
      if (first.field === 'price') priceRef.current?.focus?.();
    }, 120);
  };

  // ── Submit (one Save commits every tab) ─────────────────────────────────────
  const handleSubmit = async () => {
    const errs = collectErrors(status);
    if (errs.length) {
      setFieldErrors(errs);
      focusFirst(errs);
      showError(status === 'ACTIVE'
        ? 'Complete the highlighted fields to publish.'
        : 'Add a title and category to save.');
      return;
    }
    setFieldErrors([]);

    const durationMins = duration.trim() ? parseInt(duration, 10) : null;
    if (duration.trim() && (Number.isNaN(durationMins!) || durationMins! < 1)) {
      setSection('pricing');
      showError('Estimated duration should be a whole number of minutes.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const payload = {
      category_id:            categoryId!,
      title:                  title.trim(),
      description:            description.trim() || undefined,
      pricing_model:          pricingModel,
      // Per-model pricing parameters — the backend clears whatever the model doesn't use.
      base_price:             pricingModel === 'OUTCOME_FIXED' ? (parseFloat(price) || null) : null,
      hourly_rate:            ['HOURLY_CAPPED', 'PROVIDER_SCOPE'].includes(pricingModel)
        ? (parseFloat(hourlyRate) || null) : null,
      minimum_hours:          pricingModel === 'HOURLY_CAPPED' ? (parseFloat(minimumHours) || null) : null,
      cap_hours:              pricingModel === 'HOURLY_CAPPED' ? (parseFloat(capHours) || null) : null,
      deposit_percent:        pricingModel === 'QUOTE_DEPOSIT' ? (parseInt(depositPercent, 10) || 30) : null,
      scope_prompts:          ['PROVIDER_SCOPE', 'QUOTE_DEPOSIT'].includes(pricingModel) && scopePrompts.length
        ? scopePrompts : null,
      duration_estimate_mins: durationMins,
      status,
      is_pinned:              isPinned,
      // Omitted → backend defaults to the provider's base location.
      ...(location ? { latitude: location.lat, longitude: location.lng } : {}),
      inclusions,
      addons: addons.map((a) => ({ name: a.name.trim(), price: parseFloat(a.price) || 0 })),
    };

    try {
      savingRef.current = true;
      if (isEdit) {
        await updateService(editing!.id, payload);
        showSuccess('Service updated.');
      } else {
        await createService(payload);
        showSuccess(status === 'ACTIVE' ? 'Service published.' : 'Service saved as a draft.');
      }
      setDirty(false);
      navigation.goBack();
    } catch (e: any) {
      savingRef.current = false;
      clearError(); // we render the error ourselves; don't let the list re-show it
      // Surface backend field errors on the right tab when possible.
      if (e?.isValidation) {
        const backendErrs: FieldError[] = [];
        if (e.fieldError('title'))       backendErrs.push({ tab: 'details', field: 'title' });
        if (e.fieldError('category_id')) backendErrs.push({ tab: 'details', field: 'category' });
        if (e.fieldError('base_price'))  backendErrs.push({ tab: 'pricing', field: 'price' });
        if (e.fieldError('latitude'))    backendErrs.push({ tab: 'details', field: 'location' });
        if (backendErrs.length) { setFieldErrors(backendErrs); focusFirst(backendErrs); }
      }
      showError(e?.message ?? 'Could not save the service.');
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────────
  const categoryName = categories.find((c) => c.id === categoryId)?.name;

  const tabs: TabItem[] = [
    { key: 'details', label: 'Details', hasError: tabHasError('details') },
    { key: 'pricing', label: 'Pricing', hasError: tabHasError('pricing') },
    { key: 'extras',  label: 'Extras',  hasError: tabHasError('extras')  },
    { key: 'photos',  label: 'Photos'  },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScreenHeader
        title={isEdit ? 'Edit service' : 'New service'}
        subtitle={(title.trim() || isEdit) ? (title.trim() || editing?.title || undefined) : undefined}
        back
      />

      {onboardingStep != null && (
        <OnboardingProgress step={onboardingStep} style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.sm }} />
      )}

      <Tabs items={tabs} activeKey={section} onChange={(k) => setSection(k as SectionKey)} scrollable />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── DETAILS ───────────────────────────────────────────────── */}
          {section === 'details' && (
            <>
              <Text style={styles.subLabel}>Title</Text>
              <TextInput
                ref={titleRef}
                mode="outlined"
                placeholder="e.g. Physics tutoring (UNZA)"
                value={title}
                onChangeText={(t) => { setTitle(t); markDirty(); }}
                error={hasError('title')}
                style={styles.input}
                outlineStyle={styles.inputOutline}
              />
              {hasError('title') && <HelperText type="error" visible>Add a title.</HelperText>}

              <View style={styles.divider} />

              <Text style={styles.subLabel}>Category</Text>
              <CategoryPicker
                categories={categories}
                selectedId={categoryId}
                onSelect={(id) => { Haptics.selectionAsync(); setCategoryId(id); markDirty(); }}
              />
              {hasError('category') && <HelperText type="error" visible>Choose a category.</HelperText>}

              <View style={styles.divider} />

              <Text style={styles.subLabel}>Description</Text>
              <MarkdownEditor
                label="Description (optional)"
                placeholder="Describe what you offer — use bullets, bold, etc."
                value={description}
                onChangeText={(t: string) => { setDescription(t); markDirty(); }}
              />

              <View style={styles.divider} />

              <Text style={styles.subLabel}>Where do you offer this from?</Text>
              <TouchableRipple
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPickerVisible(true); }}
                borderless
                style={styles.rowField}
              >
                <View style={styles.rowFieldInner}>
                  <Ionicons name="location-outline" size={18} color={palette.primary} />
                  <Text style={styles.rowFieldText} numberOfLines={1}>{locationLabel ?? 'Same as my base location'}</Text>
                  <Ionicons name="chevron-forward" size={16} color={palette.textSecondary} />
                </View>
              </TouchableRipple>
              <HelperText type="info" visible>Leave as-is to use your base location, or set a different spot for this service.</HelperText>

              <View style={styles.divider} />

              <Text style={styles.subLabel}>Status</Text>
              <SegmentedButtons
                value={status}
                onValueChange={(v) => { Haptics.selectionAsync(); setStatus(v as ServiceStatus); markDirty(); }}
                buttons={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <Text style={styles.hint}>
                {status === 'ACTIVE'
                  ? 'Customers can find and book this service.'
                  : status === 'PAUSED'
                    ? 'Temporarily hidden from search — keeps its details.'
                    : 'Not listed yet — visible only to you.'}
              </Text>

              <View style={styles.divider} />

              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.switchTitle}>Pin to profile highlights</Text>
                  <Text style={styles.hint}>Feature this service near the top of your public profile.</Text>
                </View>
                <Switch value={isPinned} onValueChange={(v) => { setIsPinned(v); markDirty(); }} color={palette.primary} />
              </View>
            </>
          )}

          {/* ── PRICING ───────────────────────────────────────────────── */}
          {section === 'pricing' && (
            <>
              {editing?.needs_pricing_review && (
                <View style={styles.reviewBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color={palette.warning} />
                  <Text style={styles.reviewBannerText}>
                    Your hourly service now needs a spend cap — we've set a default of 4 hours.
                    Review it below and save to confirm.
                  </Text>
                </View>
              )}

              <Text style={styles.subLabel}>How do you price this?</Text>
              {PRICING_OPTIONS.map((opt) => {
                const active = pricingModel === opt.value;
                return (
                  <TouchableRipple
                    key={opt.value}
                    onPress={() => { Haptics.selectionAsync(); setPricingModel(opt.value); markDirty(); }}
                    borderless
                    style={[styles.modelCard, active && styles.modelCardActive]}
                  >
                    <View style={styles.modelCardInner}>
                      <Ionicons
                        name={active ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={active ? palette.primary : palette.textDisabled}
                      />
                      <View style={styles.modelCardText}>
                        <Text style={[styles.modelCardTitle, active && { color: palette.primary }]}>{opt.label}</Text>
                        <Text style={styles.modelCardDesc}>{opt.description}</Text>
                      </View>
                    </View>
                  </TouchableRipple>
                );
              })}

              <View style={styles.divider} />

              {/* ── OUTCOME_FIXED: outcome price + estimate ─────────────── */}
              {pricingModel === 'OUTCOME_FIXED' && (
                <>
                  <Text style={styles.subLabel}>Price for the outcome (ZMW)</Text>
                  <TextInput
                    ref={priceRef}
                    mode="outlined"
                    keyboardType="decimal-pad"
                    value={price}
                    onChangeText={(t) => { setPrice(t); markDirty(); }}
                    error={hasError('price')}
                    style={styles.input}
                    outlineStyle={styles.inputOutline}
                    left={<TextInput.Icon icon="cash" />}
                  />
                  {hasError('price') && <HelperText type="error" visible>Enter a price to publish.</HelperText>}
                  <Text style={styles.hint}>Describe the outcome in the title, and what's covered under Extras → What's included.</Text>

                  <Text style={styles.subLabel}>Estimated duration — shown to customers as a guide</Text>
                  <TextInput
                    mode="outlined"
                    label="Minutes (optional)"
                    keyboardType="number-pad"
                    value={duration}
                    onChangeText={(t) => { setDuration(t); markDirty(); }}
                    style={styles.input}
                    outlineStyle={styles.inputOutline}
                    left={<TextInput.Icon icon="clock-outline" />}
                  />
                  <Text style={styles.hint}>Customers never enter hours — this is only a guide on your listing.</Text>
                </>
              )}

              {/* ── HOURLY_CAPPED: rate + minimum + cap ─────────────────── */}
              {pricingModel === 'HOURLY_CAPPED' && (
                <>
                  <Text style={styles.subLabel}>Hourly rate (ZMW)</Text>
                  <TextInput
                    mode="outlined"
                    keyboardType="decimal-pad"
                    value={hourlyRate}
                    onChangeText={(t) => { setHourlyRate(t); markDirty(); }}
                    error={hasError('hourly_rate')}
                    style={styles.input}
                    outlineStyle={styles.inputOutline}
                    left={<TextInput.Icon icon="cash" />}
                    right={<TextInput.Affix text="/ hr" />}
                  />
                  {hasError('hourly_rate') && <HelperText type="error" visible>Enter your hourly rate.</HelperText>}

                  <View style={styles.hourlyRow}>
                    <View style={styles.hourlyCol}>
                      <Text style={styles.subLabel}>Minimum hours</Text>
                      <TextInput
                        mode="outlined"
                        keyboardType="decimal-pad"
                        value={minimumHours}
                        onChangeText={(t) => { setMinimumHours(t); markDirty(); }}
                        error={hasError('minimum_hours')}
                        style={styles.input}
                        outlineStyle={styles.inputOutline}
                      />
                    </View>
                    <View style={styles.hourlyCol}>
                      <Text style={styles.subLabel}>Maximum hours (cap)</Text>
                      <TextInput
                        mode="outlined"
                        keyboardType="decimal-pad"
                        value={capHours}
                        onChangeText={(t) => { setCapHours(t); markDirty(); }}
                        error={hasError('cap_hours')}
                        style={styles.input}
                        outlineStyle={styles.inputOutline}
                      />
                    </View>
                  </View>
                  {hasError('minimum_hours') && <HelperText type="error" visible>Set a minimum (e.g. 1).</HelperText>}
                  {hasError('cap_hours') && <HelperText type="error" visible>Set a cap of at least the minimum — no uncapped hourly.</HelperText>}

                  {parseFloat(hourlyRate) > 0 && parseFloat(capHours) > 0 && (
                    <View style={styles.previewBox}>
                      <Ionicons name="eye-outline" size={16} color={palette.primary} />
                      <Text style={styles.previewText}>
                        Customer sees: ZMW {parseFloat(hourlyRate).toFixed(0)}/hr · {parseFloat(minimumHours) || 1}-hr minimum
                        · max ZMW {(parseFloat(hourlyRate) * parseFloat(capHours)).toFixed(0)}.{'\n'}
                        The cap is held at booking; you log the actual time when done and the customer is refunded the difference.
                      </Text>
                    </View>
                  )}
                </>
              )}

              {/* ── PROVIDER_SCOPE: rate + brief questions ──────────────── */}
              {pricingModel === 'PROVIDER_SCOPE' && (
                <>
                  <Text style={styles.subLabel}>Your rate (ZMW — your basis for quoting)</Text>
                  <TextInput
                    mode="outlined"
                    keyboardType="decimal-pad"
                    value={hourlyRate}
                    onChangeText={(t) => { setHourlyRate(t); markDirty(); }}
                    error={hasError('hourly_rate')}
                    style={styles.input}
                    outlineStyle={styles.inputOutline}
                    left={<TextInput.Icon icon="cash" />}
                    right={<TextInput.Affix text="/ hr" />}
                  />
                  {hasError('hourly_rate') && <HelperText type="error" visible>Enter your rate — it's your quoting basis (not shown as a fixed price).</HelperText>}
                  <Text style={styles.quoteHint}>
                    Customers answer your questions below, you review the brief and send a scoped quote
                    (price + duration + what's included). Money is only held after they approve it.
                  </Text>
                </>
              )}

              {/* ── QUOTE_DEPOSIT: deposit % ────────────────────────────── */}
              {pricingModel === 'QUOTE_DEPOSIT' && (
                <>
                  <Text style={styles.subLabel}>Deposit to confirm (%)</Text>
                  <TextInput
                    mode="outlined"
                    keyboardType="number-pad"
                    value={depositPercent}
                    onChangeText={(t) => { setDepositPercent(t); markDirty(); }}
                    error={hasError('deposit_percent')}
                    style={styles.input}
                    outlineStyle={styles.inputOutline}
                    left={<TextInput.Icon icon="percent" />}
                  />
                  {hasError('deposit_percent') && <HelperText type="error" visible>Deposit must be between 10% and 90%.</HelperText>}
                  <Text style={styles.quoteHint}>
                    For large or complex jobs: the customer sends a detailed brief, you send a full quote.
                    They pay {parseInt(depositPercent, 10) || 30}% into escrow to confirm; the balance is
                    collected automatically when the job completes (two Mobile Money collections).
                  </Text>
                </>
              )}

              {/* ── Brief questions (both quote-first models) ───────────── */}
              {(pricingModel === 'PROVIDER_SCOPE' || pricingModel === 'QUOTE_DEPOSIT') && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.subLabel}>Questions customers answer when booking</Text>
                  <Text style={styles.hint}>
                    Structured prompts — e.g. "How many bedrooms?", "Any pets?". Leave empty to use our defaults.
                  </Text>
                  {scopePrompts.map((prompt, index) => (
                    <View key={`${prompt}-${index}`} style={styles.listRow}>
                      <Ionicons name="help-circle-outline" size={18} color={palette.primary} />
                      <Text style={styles.listText} numberOfLines={2}>{prompt}</Text>
                      <TouchableRipple onPress={() => removeScopePrompt(index)} borderless style={styles.listActionBtn}>
                        <Ionicons name="close" size={16} color={palette.danger} />
                      </TouchableRipple>
                    </View>
                  ))}
                  <View style={styles.addRow}>
                    <TextInput
                      mode="outlined"
                      placeholder='e.g. "How many rooms?"'
                      value={scopePromptDraft}
                      onChangeText={setScopePromptDraft}
                      onSubmitEditing={addScopePrompt}
                      returnKeyType="done"
                      style={[styles.input, styles.addInput]}
                      outlineStyle={styles.inputOutline}
                      dense
                    />
                    <TouchableRipple onPress={addScopePrompt} borderless style={styles.addBtn}>
                      <Ionicons name="add" size={20} color="#FFFFFF" />
                    </TouchableRipple>
                  </View>
                </>
              )}

              {/* Earnings preview — payment_mode-aware (§ commission rule) */}
              {previewBasis > 0 && (
                <View style={[styles.previewBox, paymentMode === 'DIRECT' && styles.previewBoxDirect]}>
                  <Ionicons
                    name={paymentMode === 'DIRECT' ? 'checkmark-circle-outline' : 'information-circle-outline'}
                    size={16}
                    color={paymentMode === 'DIRECT' ? palette.success : palette.primary}
                  />
                  {paymentMode === 'DIRECT' ? (
                    <Text style={styles.previewText}>
                      You’re paid the full ZMW {previewBasis.toFixed(0)} directly — no commission is charged.
                    </Text>
                  ) : previewLoading && !preview ? (
                    <Text style={styles.previewText}>Calculating your commission…</Text>
                  ) : preview ? (
                    <Text style={styles.previewText}>
                      At ZMW {preview.gross.toFixed(0)}, {categoryName ?? 'this category'}/Tier {preview.tier} commission
                      is {(preview.effective_rate * 100).toFixed(1)}%. You keep ~ZMW {preview.net_to_provider.toFixed(0)}.
                    </Text>
                  ) : null}
                </View>
              )}
            </>
          )}

          {/* ── EXTRAS ────────────────────────────────────────────────── */}
          {section === 'extras' && (
            <>
              <Text style={styles.subLabel}>What’s included</Text>
              {hasError('inclusions') && (
                <HelperText type="error" visible>Add at least one inclusion to publish.</HelperText>
              )}
              {inclusions.map((item, index) => (
                <View key={`${item}-${index}`} style={styles.listRow}>
                  <Ionicons name="checkmark-circle-outline" size={18} color={palette.success} />
                  <Text style={styles.listText} numberOfLines={2}>{item}</Text>
                  <View style={styles.listActions}>
                    <TouchableRipple onPress={() => moveInclusion(index, -1)} disabled={index === 0} borderless style={styles.listActionBtn}>
                      <Ionicons name="chevron-up" size={16} color={index === 0 ? palette.textDisabled : palette.textSecondary} />
                    </TouchableRipple>
                    <TouchableRipple onPress={() => moveInclusion(index, 1)} disabled={index === inclusions.length - 1} borderless style={styles.listActionBtn}>
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

              <View style={styles.divider} />

              <Text style={styles.subLabel}>Add-ons (optional extras)</Text>
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
            </>
          )}

          {/* ── PHOTOS ────────────────────────────────────────────────── */}
          {section === 'photos' && (
            <>
              {!isEdit ? (
                <View style={styles.photoNotice}>
                  <Ionicons name="images-outline" size={28} color={palette.textDisabled} />
                  <Text style={styles.photoNoticeText}>
                    Save this service first, then reopen it to add photos.
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={styles.subLabel}>Photos ({photos.length}/8)</Text>
                  <Text style={styles.hint}>The first photo is your cover. Use the arrows to reorder.</Text>
                  {photoError && <HelperText type="error" visible>{photoError}</HelperText>}

                  <View style={styles.photoGrid}>
                    {photos.map((photo, index) => (
                      <View key={photo.id} style={styles.photoCell}>
                        <Image source={{ uri: storageUrl(photo.path) }} style={styles.photoImg} contentFit="cover" transition={120} />
                        {index === 0 && (
                          <View style={styles.coverBadge}><Text style={styles.coverBadgeText}>Cover</Text></View>
                        )}
                        <View style={styles.photoOverlay}>
                          <TouchableRipple onPress={() => movePhoto(index, -1)} disabled={index === 0} borderless style={styles.photoCtl}>
                            <Ionicons name="chevron-back" size={16} color={index === 0 ? 'rgba(255,255,255,0.4)' : '#fff'} />
                          </TouchableRipple>
                          <TouchableRipple onPress={() => movePhoto(index, 1)} disabled={index === photos.length - 1} borderless style={styles.photoCtl}>
                            <Ionicons name="chevron-forward" size={16} color={index === photos.length - 1 ? 'rgba(255,255,255,0.4)' : '#fff'} />
                          </TouchableRipple>
                          <TouchableRipple onPress={() => deletePhoto(photo)} disabled={busyPhotoId === photo.id} borderless style={styles.photoCtl}>
                            {busyPhotoId === photo.id
                              ? <ActivityIndicator size={12} color="#fff" />
                              : <Ionicons name="trash-outline" size={15} color="#fff" />}
                          </TouchableRipple>
                        </View>
                      </View>
                    ))}

                    {photos.length < 8 && (
                      <TouchableRipple onPress={addPhoto} disabled={uploading} borderless style={[styles.photoCell, styles.addTile]}>
                        <View style={styles.addTileInner}>
                          {uploading
                            ? <ActivityIndicator color={palette.primary} />
                            : <Ionicons name="camera-outline" size={26} color={palette.textDisabled} />}
                          <Text style={styles.addTileText}>{photos.length === 0 ? 'Add photo' : 'Add'}</Text>
                        </View>
                      </TouchableRipple>
                    )}
                  </View>
                </>
              )}
            </>
          )}
        </ScrollView>

        {/* ── Persistent save bar (spans every tab) ────────────────────── */}
        <View style={[styles.saveBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={loading}
            disabled={loading}
            style={styles.saveBtn}
            contentStyle={styles.saveBtnContent}
            labelStyle={styles.saveBtnLabel}
          >
            {status === 'ACTIVE' ? (isEdit ? 'Save & publish' : 'Publish') : 'Save'}
          </Button>
        </View>
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

// ── Category picker (searchable) ────────────────────────────────────────────

function flattenCategories(cats: Category[]): Category[] {
  const out: Category[] = [];
  for (const c of cats) {
    out.push(c);
    if (c.children?.length) out.push(...flattenCategories(c.children));
  }
  return out;
}

function CategoryPicker({
  categories,
  selectedId,
  onSelect,
}: {
  categories: Category[];
  selectedId: number | undefined;
  onSelect:   (id: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);

  const all = useMemo(() => flattenCategories(categories), [categories]);
  const selected = all.find((c) => c.id === selectedId);

  const filtered = useMemo(() => {
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.synonyms?.some((s) => s.toLowerCase().includes(q)),
    );
  }, [all, query]);

  const handleSelect = (cat: Category) => {
    onSelect(cat.id);
    setQuery('');
    setOpen(false);
  };

  return (
    <View style={cpStyles.wrap}>
      {/* Selected chip */}
      {selected && !open && (
        <Pressable onPress={() => setOpen(true)} style={cpStyles.selectedChip}>
          {selected.icon && (
            <Ionicons name={selected.icon as any} size={14} color={palette.primary} />
          )}
          <Text style={cpStyles.selectedText}>{selected.name}</Text>
          <Ionicons name="chevron-down" size={14} color={palette.textSecondary} />
        </Pressable>
      )}

      {/* Search input */}
      {(!selected || open) && (
        <View style={cpStyles.inputWrap}>
          <Ionicons name="search-outline" size={16} color={palette.textSecondary} style={cpStyles.searchIcon} />
          <RNTextInput
            style={cpStyles.input}
            placeholder="Search categories…"
            placeholderTextColor={palette.textDisabled}
            value={query}
            onChangeText={(t) => { setQuery(t); setOpen(true); }}
            onFocus={() => setOpen(true)}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={palette.textDisabled} />
            </Pressable>
          )}
        </View>
      )}

      {/* Results dropdown */}
      {open && (
        <View style={cpStyles.dropdown}>
          <ScrollView style={cpStyles.dropdownScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {filtered.length === 0 ? (
              <Text style={cpStyles.empty}>No categories found</Text>
            ) : (
              filtered.map((cat) => {
                const isActive = cat.id === selectedId;
                return (
                  <Pressable
                    key={cat.id}
                    onPress={() => handleSelect(cat)}
                    style={[cpStyles.row, isActive && cpStyles.rowActive]}
                  >
                    {cat.icon && (
                      <Ionicons
                        name={cat.icon as any}
                        size={16}
                        color={isActive ? palette.primary : palette.textSecondary}
                      />
                    )}
                    <Text
                      style={[cpStyles.rowText, isActive && cpStyles.rowTextActive]}
                      numberOfLines={1}
                    >
                      {cat.name}
                    </Text>
                    {isActive && <Ionicons name="checkmark" size={16} color={palette.primary} />}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const cpStyles = StyleSheet.create({
  wrap: { marginBottom: spacing.xs },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs + 4,
    paddingHorizontal: spacing.md,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.primary,
    backgroundColor: palette.primaryLight,
  },
  selectedText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    color: palette.primary,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.sm,
    minHeight: 44,
  },
  searchIcon: { marginRight: spacing.xs },
  input: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: palette.textPrimary,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm : spacing.xs,
  },
  dropdown: {
    marginTop: spacing.xs,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    overflow: 'hidden',
  },
  dropdownScroll: { maxHeight: 220 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  rowActive: { backgroundColor: palette.primaryLight },
  rowText: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: palette.textPrimary,
  },
  rowTextActive: { fontFamily: fontFamily.medium, color: palette.primary },
  empty: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: palette.textDisabled,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: r.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title:    { ...typography.heading2, color: palette.textPrimary },
  subtitle: { ...typography.bodySmall, color: palette.textSecondary },

  subLabel: { ...typography.label, color: palette.textPrimary, marginBottom: spacing.xs, marginTop: spacing.sm },
  hint:     { ...typography.bodySmall, color: palette.textSecondary, marginBottom: spacing.sm, fontSize: 13 },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.md },

  input:        { backgroundColor: palette.surface },
  inputOutline: { borderRadius: r.sm },

  catWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  catChip: {
    paddingVertical: spacing.xs + 4,
    paddingHorizontal: spacing.md,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  catChipActive:     { borderColor: palette.primary, backgroundColor: palette.primaryLight },
  catChipText:       { ...typography.bodySmall, color: palette.textSecondary },
  catChipTextActive: { color: palette.primary, fontFamily: 'DMSans_500Medium' },

  rowField: {
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  rowFieldError: { borderColor: palette.danger },
  rowFieldInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 52 },
  rowFieldText:  { ...typography.body, color: palette.textPrimary, flex: 1, fontSize: 15 },

  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  switchText: { flex: 1 },
  switchTitle: { ...typography.label, color: palette.textPrimary, fontSize: 15, marginBottom: 2 },

  quoteHint: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    backgroundColor: palette.primaryLight,
    borderRadius: r.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },

  // Outcome-based pricing model picker
  modelCard: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: r.sm,
    backgroundColor: palette.background,
    marginBottom: spacing.xs,
  },
  modelCardActive: { borderColor: palette.primary, backgroundColor: palette.primaryLight },
  modelCardInner:  { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md },
  modelCardText:   { flex: 1 },
  modelCardTitle:  { ...typography.label, color: palette.textPrimary, fontSize: 14 },
  modelCardDesc:   { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12, marginTop: 2 },

  hourlyRow: { flexDirection: 'row', gap: spacing.sm },
  hourlyCol: { flex: 1 },

  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: palette.warningLight,
    borderRadius: r.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  reviewBannerText: { ...typography.bodySmall, color: palette.warning, flex: 1, lineHeight: 18 },

  previewBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: palette.primaryLight,
    borderRadius: r.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  previewBoxDirect: { backgroundColor: palette.successLight },
  previewText: { ...typography.bodySmall, color: palette.textPrimary, flex: 1, fontSize: 13, lineHeight: 18 },

  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  listText: { ...typography.body, color: palette.textPrimary, flex: 1, fontSize: 14 },
  listActions: { flexDirection: 'row', alignItems: 'center' },
  listActionBtn: { width: 32, height: 32, borderRadius: r.sm, alignItems: 'center', justifyContent: 'center' },
  addonPrice: { ...typography.label, color: palette.primary, fontSize: 14 },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  addInput: { flex: 1 },
  addonPriceInput: { width: 100 },
  addBtn: { width: 44, height: 44, borderRadius: r.sm, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  photoCell: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: r.sm,
    overflow: 'hidden',
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  photoImg: { width: '100%', height: '100%' },
  coverBadge: {
    position: 'absolute', top: 4, left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: r.sm,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  coverBadgeText: { color: '#fff', fontSize: 10, fontFamily: 'DMSans_500Medium' },
  photoOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingVertical: 2,
  },
  photoCtl: { width: 32, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: r.sm },
  addTile: { borderStyle: 'dashed', borderColor: palette.border },
  addTileInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  addTileText: { ...typography.bodySmall, color: palette.textDisabled, fontSize: 12 },

  photoNotice: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  photoNoticeText: { ...typography.body, color: palette.textSecondary, textAlign: 'center', paddingHorizontal: spacing.lg },

  // Save bar
  saveBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
  },
  saveBtn:        { borderRadius: r.sm },
  saveBtnContent: { height: 52 },
  saveBtnLabel:   { ...typography.label, fontSize: 16 },
});
