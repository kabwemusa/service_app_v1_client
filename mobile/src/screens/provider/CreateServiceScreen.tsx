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
import { Button, HelperText, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocationSearch } from '../../components/ui/LocationSearch';
import { MarkdownEditor } from '../../components/ui/MarkdownEditor';
import { Service } from '../../api/services';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useCategoryStore } from '../../store/categoryStore';
import { useServiceStore } from '../../store/serviceStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

export default function CreateServiceScreen({ navigation, route }: any) {
  const editing: Service | undefined = route.params?.service;
  const isEdit = !!editing;
  const insets = useSafeAreaInsets();

  const { categories, fetchCategories } = useCategoryStore();
  const { loading, error, createService, updateService, clearError } = useServiceStore();
  const { showSuccess, showError } = useSnackbar();

  const [categoryId, setCategoryId] = useState<number | undefined>(editing?.category_id);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [price, setPrice] = useState(editing?.base_price?.toString() ?? '');
  const [lat, setLat] = useState(editing?.latitude?.toString() ?? '');
  const [lng, setLng] = useState(editing?.longitude?.toString() ?? '');
  const [locationLabel, setLocationLabel] = useState('');

  useEffect(() => { fetchCategories(); }, []);

  useEffect(() => {
    if (error && !error.isValidation) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const titleErr = error?.isValidation ? error.fieldError('title') : null;
  const priceErr = error?.isValidation ? error.fieldError('base_price') : null;
  const latErr   = error?.isValidation ? error.fieldError('latitude') : null;
  const catErr   = error?.isValidation ? error.fieldError('category_id') : null;

  const handleSubmit = async () => {
    if (!categoryId) { showError('Please select a category.'); return; }
    const latitude  = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      showError('Please set a service location before saving.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const payload = {
        category_id: categoryId,
        title: title.trim(),
        description: description.trim() || undefined,
        base_price: parseFloat(price),
        latitude,
        longitude,
      };
      if (isEdit) {
        await updateService(editing!.id, payload);
        showSuccess('Service updated.');
      } else {
        await createService(payload);
        showSuccess('Service created.');
      }
      navigation.goBack();
    } catch {}
  };

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

            <View>
              <TextInput
                mode="outlined"
                label="Price (ZMW)"
                keyboardType="decimal-pad"
                value={price}
                onChangeText={setPrice}
                error={!!priceErr}
                style={styles.input}
                outlineStyle={styles.inputOutline}
                left={<TextInput.Icon icon="cash" />}
              />
              {priceErr && <HelperText type="error" visible>{priceErr}</HelperText>}
            </View>
          </View>

          <Text style={styles.sectionLabel}>Service Location</Text>
          <View style={styles.card}>
            <LocationSearch
              lat={lat}
              lng={lng}
              locationLabel={locationLabel}
              onLocationChange={(newLat, newLng, label) => {
                setLat(newLat);
                setLng(newLng);
                setLocationLabel(label);
              }}
              latError={latErr}
            />
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
            {isEdit ? 'Save Changes' : 'Create Service'}
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

  submitBtn:        { borderRadius: r.lg },
  submitBtnContent: { height: 54 },
  submitBtnLabel:   { ...typography.label, fontSize: 16 },
});
