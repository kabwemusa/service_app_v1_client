import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { storageUrl } from '../../api/client';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useAuthStore } from '../../store/authStore';
import { palette, radius as r, spacing, typography } from '../../theme';

function initials(name: string, fallback?: string | null): string {
  const source = name.trim() || fallback?.trim() || '';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const take = parts.length >= 2 ? [parts[0], parts[1]] : [parts[0]];
  return take.map((p) => p[0]).join('').toUpperCase();
}

export default function EditProfileScreen({ navigation }: any) {
  const { user, updateAccount, uploadAvatar, loading } = useAuthStore();
  const { showError, showSuccess } = useSnackbar();

  const [phone, setPhone] = useState(user?.phone ?? '');
  const [name,  setName]  = useState(user?.legal_name ?? '');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const handleSave = async () => {
    try {
      await updateAccount({
        phone: phone.trim() || null,
        name:  name.trim()  || null,
      });
      showSuccess('Profile updated.');
      navigation.goBack();
    } catch (e: any) {
      showError(e?.message ?? 'Could not save changes. Please try again.');
    }
  };

  const handleChangePhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') { showError('Photo library permission is required.'); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setUploadingPhoto(true);
    setAvatarFailed(false);
    try {
      await uploadAvatar({ uri: asset.uri, name: `avatar_${Date.now()}.jpg`, mimeType: 'image/jpeg' });
      showSuccess('Profile photo updated.');
    } catch (e: any) {
      showError(e?.message ?? 'Could not upload photo. Please try again.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={22} color={palette.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Edit Profile</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Profile photo */}
          <View style={styles.avatarSection}>
            <TouchableOpacity
              onPress={handleChangePhoto}
              disabled={uploadingPhoto}
              style={styles.avatar}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
            >
              {user?.avatar_url && !avatarFailed ? (
                <Image
                  source={{ uri: storageUrl(user.avatar_url) }}
                  style={styles.avatarImg}
                  contentFit="cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <Text style={styles.avatarText}>{initials(name, user?.email ?? user?.phone)}</Text>
              )}
              {uploadingPhoto && (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator size={22} color="#FFFFFF" />
                </View>
              )}
              <View style={styles.avatarEditBadge}>
                <Ionicons name="camera" size={14} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
            <Text style={styles.avatarHint}>Tap to change your photo</Text>
          </View>

          <View style={styles.card}>
            {/* Phone number */}
            <View style={styles.field}>
              <Text style={styles.label}>Phone number</Text>
              <Text style={styles.hint}>
                Required for Mobile Money payments (e.g. 0977123456 or +260977123456)
              </Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="e.g. 0977 123 456"
                placeholderTextColor={palette.textDisabled}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                accessibilityLabel="Phone number"
              />
            </View>

            <View style={styles.sep} />

            {/* Full name */}
            <View style={styles.field}>
              <Text style={styles.label}>Full name</Text>
              <Text style={styles.hint}>Your legal name as it appears on your ID</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Micheal Kabwe"
                placeholderTextColor={palette.textDisabled}
                autoComplete="name"
                textContentType="name"
                accessibilityLabel="Full name"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, loading && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={loading}
            accessibilityLabel="Save changes"
            accessibilityRole="button"
          >
            {loading
              ? <ActivityIndicator size={18} color="#FFFFFF" />
              : <Text style={styles.saveBtnText}>Save changes</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },

  header: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { ...typography.heading3, color: palette.textPrimary },

  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop:        spacing.sm,
    paddingBottom:     spacing.xl,
    gap:               spacing.lg,
  },

  avatarSection: { alignItems: 'center', gap: spacing.xs },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 28,
    color: palette.primary,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: palette.primary,
    borderWidth: 2,
    borderColor: palette.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHint: { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12 },

  card: {
    backgroundColor: palette.surface,
    borderRadius:    r.sm,
    borderWidth:     1,
    borderColor:     palette.border,
    padding:         spacing.md,
  },

  field: { gap: 4 },

  label: { ...typography.label, color: palette.textPrimary, fontSize: 14 },
  hint:  { ...typography.bodySmall, color: palette.textSecondary, fontSize: 12, marginBottom: 6 },

  input: {
    borderWidth:   1,
    borderColor:   palette.border,
    borderRadius:  r.md,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    color:         palette.textPrimary,
    fontSize:      15,
    fontFamily:    'DMSans_400Regular',
    minHeight:     48,
  },

  sep: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.md },

  saveBtn: {
    backgroundColor: palette.primary,
    borderRadius:    r.sm,
    paddingVertical: spacing.md,
    alignItems:      'center',
    justifyContent:  'center',
    minHeight:       52,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { ...typography.label, color: '#FFFFFF', fontSize: 15 },
});
