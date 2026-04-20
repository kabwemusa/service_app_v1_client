import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { ActivityIndicator, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { storageUrl } from '../../api/client';
import { ApiError } from '../../api/errors';
import { ServicePhoto, servicesApi } from '../../api/services';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

const SCREEN_W  = Dimensions.get('window').width;
const CELL_GAP  = spacing.sm;
const CELL_SIZE = (SCREEN_W - spacing.lg * 2 - CELL_GAP) / 2;

export default function ServicePhotosScreen({ navigation, route }: any) {
  const serviceId: string    = route.params?.serviceId;
  const serviceTitle: string = route.params?.serviceTitle ?? 'Service';

  const insets = useSafeAreaInsets();
  const { showSuccess, showError } = useSnackbar();

  const [photos, setPhotos]       = useState<ServicePhoto[]>([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    loadPhotos();
  }, [serviceId]);

  async function loadPhotos() {
    try {
      setLoading(true);
      const svc = await servicesApi.show(serviceId);
      setPhotos(svc.photos ?? []);
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Failed to load photos.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (photos.length >= 8) {
      showError('Maximum 8 photos per service.');
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showError('Photo library permission is required.');
      return;
    }

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
    formData.append('photo', {
      uri:  asset.uri,
      name: `photo_${Date.now()}.jpg`,
      type: 'image/jpeg',
    } as any);

    setUploading(true);
    try {
      const photo = await servicesApi.uploadPhoto(serviceId, formData);
      setPhotos((prev) => [...prev, photo]);
      showSuccess('Photo added.');
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function confirmDelete(photo: ServicePhoto) {
    Alert.alert('Remove photo', 'Delete this photo from your service?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => doDelete(photo),
      },
    ]);
  }

  async function doDelete(photo: ServicePhoto) {
    setDeletingId(photo.id);
    try {
      await servicesApi.deletePhoto(serviceId, photo.id);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Failed to delete photo.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableRipple onPress={() => navigation.goBack()} borderless style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={palette.textPrimary} />
        </TouchableRipple>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle}>Photos</Text>
          <Text style={styles.navSub} numberOfLines={1}>{serviceTitle}</Text>
        </View>
        <TouchableRipple
          onPress={handleAdd}
          borderless
          style={[styles.backBtn, uploading && { opacity: 0.5 }]}
          disabled={uploading || photos.length >= 8}
        >
          {uploading
            ? <ActivityIndicator size={18} color={palette.primary} />
            : <Ionicons name="add" size={22} color={palette.primary} />}
        </TouchableRipple>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(p) => String(p.id)}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={photos.length < 8 ? (
            <TouchableOpacity style={styles.addTile} onPress={handleAdd} disabled={uploading}>
              {uploading
                ? <ActivityIndicator color={palette.primary} />
                : <Ionicons name="camera-outline" size={32} color={palette.textDisabled} />}
              <Text style={styles.addTileText}>
                {photos.length === 0 ? 'Add your first photo' : `Add photo (${photos.length}/8)`}
              </Text>
            </TouchableOpacity>
          ) : null}
          ListEmptyComponent={null}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <Image
                source={{ uri: storageUrl(item.path) }}
                style={styles.cellImage}
                contentFit="cover"
                transition={150}
              />
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => confirmDelete(item)}
                disabled={deletingId === item.id}
              >
                {deletingId === item.id
                  ? <ActivityIndicator size={14} color="#fff" />
                  : <Ionicons name="trash" size={14} color="#fff" />}
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: r.full,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.border,
  },
  navCenter: { flex: 1 },
  navTitle: { ...typography.label, color: palette.textPrimary },
  navSub:   { ...typography.bodySmall, color: palette.textSecondary },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  grid: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  row:  { gap: CELL_GAP, marginBottom: CELL_GAP },

  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: r.lg,
    overflow: 'hidden',
    backgroundColor: palette.surface,
    ...shadow.card,
  },
  cellImage: { width: '100%', height: '100%' },
  deleteBtn: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 28, height: 28,
    borderRadius: r.full,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },

  addTile: {
    width: '100%',
    height: CELL_SIZE,
    borderRadius: r.lg,
    borderWidth: 1.5,
    borderColor: palette.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  addTileText: { ...typography.bodySmall, color: palette.textDisabled },
});
