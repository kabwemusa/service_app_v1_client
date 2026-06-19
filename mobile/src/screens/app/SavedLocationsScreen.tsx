import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, Switch, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { locationApi, PlaceCandidate, SavedLocation } from '../../api/location';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useLocationStore } from '../../store/locationStore';
import { palette, radius as r, spacing, typography } from '../../theme';

const QUICK_LABELS = ['Home', 'Work', 'Gym', 'Other'];

/** v3.1 §4.2/§4.5-A — the address book screen: view, add, promote, and remove saved places. */
export default function SavedLocationsScreen({ navigation }: any) {
  const insets   = useSafeAreaInsets();
  const showBack = navigation.canGoBack();

  const { saved, savedLoading, error, fetchSaved, deleteSaved, updateSaved, clearError } = useLocationStore();
  const { showError, showSuccess } = useSnackbar();

  const [addVisible, setAddVisible] = useState(false);

  useEffect(() => {
    fetchSaved();
  }, []);

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const handlePromote = (location: SavedLocation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Set as primary location',
      `"${location.label}" will become the location we use to find providers near you by default.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set as primary',
          onPress: async () => {
            const ok = await updateSaved(location.id, { is_primary: true });
            if (ok) showSuccess(`${location.label} is now your primary location.`);
          },
        },
      ],
    );
  };

  const handleDelete = (location: SavedLocation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Remove place',
      `Remove "${location.label}" from your saved places?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            const ok = await deleteSaved(location.id);
            if (ok) showSuccess('Place removed.');
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        {showBack ? (
          <TouchableRipple onPress={() => navigation.goBack()} borderless style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={palette.textPrimary} />
          </TouchableRipple>
        ) : (
          <View style={styles.backBtnPlaceholder} />
        )}
        <View style={styles.headerText}>
          <Text style={styles.title}>Saved places</Text>
          <Text style={styles.subtitle}>Your address book — Home, Work, and other places.</Text>
        </View>
      </View>

      {savedLoading && saved.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : (
        <FlatList
          data={saved}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xxl }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="location-outline" size={44} color={palette.textDisabled} />
              <Text style={styles.emptyTitle}>No saved places yet</Text>
              <Text style={styles.emptyText}>Add Home, Work, or anywhere else you book services often.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={[styles.rowIcon, item.is_primary && styles.rowIconPrimary]}>
                <Ionicons
                  name={item.is_primary ? 'home' : 'bookmark'}
                  size={18}
                  color={item.is_primary ? palette.primary : palette.textSecondary}
                />
              </View>
              <View style={styles.rowText}>
                <View style={styles.rowLabelLine}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
                  {item.is_primary && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>Primary</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.rowSub} numberOfLines={1}>{item.place_name}</Text>
              </View>
              {!item.is_primary && (
                <View style={styles.rowActions}>
                  <TouchableOpacity
                    onPress={() => handlePromote(item)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.rowActionBtn}
                  >
                    <Ionicons name="star-outline" size={18} color={palette.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDelete(item)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.rowActionBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color={palette.danger} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        />
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Button
          mode="contained"
          icon={() => <Ionicons name="add" size={18} color="#FFFFFF" />}
          onPress={() => setAddVisible(true)}
          style={styles.addBtn}
          contentStyle={styles.addBtnContent}
          labelStyle={styles.addBtnLabel}
        >
          Add a place
        </Button>
      </View>

      <AddPlaceModal visible={addVisible} onClose={() => setAddVisible(false)} />
    </SafeAreaView>
  );
}

// ── Add-a-place modal ────────────────────────────────────────────────────────

function AddPlaceModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { createSaved, saved, loading } = useLocationStore();
  const { showError, showSuccess } = useSnackbar();

  const [step, setStep]               = useState<'search' | 'name'>('search');
  const [query, setQuery]             = useState('');
  const [suggestions, setSuggestions] = useState<PlaceCandidate[]>([]);
  const [searching, setSearching]     = useState(false);
  const [picked, setPicked]           = useState<PlaceCandidate | null>(null);
  const [label, setLabel]             = useState('');
  const [makePrimary, setMakePrimary] = useState(false);
  const [saving, setSaving]           = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setStep('search');
      setQuery('');
      setSuggestions([]);
      setPicked(null);
      setLabel('');
      setMakePrimary(false);
    }
  }, [visible]);

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

  const handlePick = (candidate: PlaceCandidate) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPicked(candidate);
    setLabel(candidate.label.split(',')[0]?.trim() ?? candidate.label);
    setStep('name');
  };

  const handleSave = async () => {
    if (!picked || !label.trim()) return;
    setSaving(true);
    try {
      const result = await createSaved({
        label:       label.trim(),
        place_name:  picked.place_name,
        lat:         picked.lat,
        lng:         picked.lng,
        region:      picked.region,
        is_primary:  makePrimary,
      });
      if (result) {
        showSuccess('Place saved.');
        onClose();
      } else {
        showError('Could not save that place. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <KeyboardAvoidingView style={styles.modalKav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.handle} />
            <View style={styles.modalHeader}>
              {step === 'name' ? (
                <TouchableOpacity onPress={() => setStep('search')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="chevron-back" size={20} color={palette.textSecondary} />
                </TouchableOpacity>
              ) : (
                <View style={{ width: 20 }} />
              )}
              <Text style={styles.modalTitle}>{step === 'search' ? 'Find a place' : 'Name this place'}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color={palette.textSecondary} />
              </TouchableOpacity>
            </View>

            {step === 'search' ? (
              <View style={styles.modalBody}>
                <TextInput
                  mode="outlined"
                  placeholder="Search for an address, landmark, or area…"
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
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.suggestion} onPress={() => handlePick(item)}>
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
                      <Text style={styles.emptyHint}>No places found. Try a different search.</Text>
                    ) : null
                  }
                />
              </View>
            ) : (
              <View style={styles.modalBody}>
                {picked && (
                  <View style={styles.pickedPlace}>
                    <Ionicons name="location" size={18} color={palette.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickedLabel} numberOfLines={1}>{picked.label}</Text>
                      {!!picked.region && <Text style={styles.pickedRegion} numberOfLines={1}>{picked.region}</Text>}
                    </View>
                  </View>
                )}

                <Text style={styles.fieldLabel}>What should we call it?</Text>
                <View style={styles.quickChips}>
                  {QUICK_LABELS.map((q) => (
                    <TouchableOpacity
                      key={q}
                      style={[styles.quickChip, label === q && styles.quickChipActive]}
                      onPress={() => setLabel(q)}
                    >
                      <Text style={[styles.quickChipText, label === q && styles.quickChipTextActive]}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  mode="outlined"
                  placeholder="e.g. Home"
                  value={label}
                  onChangeText={setLabel}
                  maxLength={120}
                  style={styles.input}
                  outlineStyle={styles.inputOutline}
                />

                {saved.length > 0 && (
                  <View style={styles.primaryRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Set as primary location</Text>
                      <Text style={styles.fieldHint}>We'll use this to find providers near you by default.</Text>
                    </View>
                    <Switch value={makePrimary} onValueChange={setMakePrimary} color={palette.primary} />
                  </View>
                )}

                <Button
                  mode="contained"
                  onPress={handleSave}
                  loading={saving || loading}
                  disabled={!label.trim() || saving || loading}
                  style={styles.saveBtn}
                  contentStyle={styles.addBtnContent}
                  labelStyle={styles.addBtnLabel}
                >
                  Save place
                </Button>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: r.full,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border,
  },
  backBtnPlaceholder: { width: 36, height: 36 },
  headerText: { flex: 1 },
  title:    { ...typography.heading2, color: palette.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.bodySmall, color: palette.textSecondary },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  list: { paddingHorizontal: spacing.lg, gap: spacing.xs },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: r.full,
    backgroundColor: palette.background,
    alignItems: 'center', justifyContent: 'center',
  },
  rowIconPrimary: { backgroundColor: palette.primaryLight },
  rowText: { flex: 1 },
  rowLabelLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rowLabel: { ...typography.label, color: palette.textPrimary, fontSize: 15, flexShrink: 1 },
  rowSub:   { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12, marginTop: 1 },
  rowActions: { flexDirection: 'row', gap: spacing.sm },
  rowActionBtn: { padding: spacing.xs },

  badge: {
    backgroundColor: palette.primaryLight,
    borderRadius: r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { ...typography.label, color: palette.primary, fontSize: 10 },

  empty: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xl, gap: spacing.xs },
  emptyTitle: { ...typography.heading3, color: palette.textPrimary, marginTop: spacing.sm },
  emptyText:  { ...typography.bodySmall, color: palette.textSecondary, textAlign: 'center' },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.background,
  },
  addBtn: { borderRadius: r.sm },
  addBtnContent: { height: 50 },
  addBtnLabel: { ...typography.label, fontSize: 15 },

  // ── Modal ──────────────────────────────────────────────────────────────────
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  modalKav: { justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: r.sm,
    borderTopRightRadius: r.sm,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: r.full,
    backgroundColor: palette.border, marginTop: spacing.sm,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 4,
    borderBottomWidth: 1, borderBottomColor: palette.border,
  },
  modalTitle: { ...typography.label, color: palette.textPrimary, fontSize: 16 },
  modalBody: { padding: spacing.lg },

  input: { backgroundColor: '#FFFFFF', marginBottom: spacing.sm },
  inputOutline: { borderRadius: r.sm },

  suggestion: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  suggestionLabel:  { ...typography.label, color: palette.textPrimary, fontSize: 14 },
  suggestionRegion: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },
  sep: { height: 1, backgroundColor: palette.border },
  emptyHint: { ...typography.bodySmall, color: palette.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },

  pickedPlace: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: palette.primaryLight, borderRadius: r.sm,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  pickedLabel:  { ...typography.label, color: palette.textPrimary, fontSize: 15 },
  pickedRegion: { ...typography.bodySmall, color: palette.textSecondary, marginTop: 1 },

  fieldLabel: { ...typography.label, color: palette.textPrimary, fontSize: 13, marginBottom: spacing.xs },
  fieldHint:  { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },

  quickChips: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm, flexWrap: 'wrap' },
  quickChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: r.full, borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  quickChipActive: { backgroundColor: palette.primary, borderColor: palette.primary },
  quickChipText: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 13 },
  quickChipTextActive: { color: '#FFFFFF' },

  primaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md, marginBottom: spacing.lg,
    backgroundColor: palette.background, borderRadius: r.sm, padding: spacing.md,
  },

  saveBtn: { borderRadius: r.sm, marginTop: spacing.xs },
});
