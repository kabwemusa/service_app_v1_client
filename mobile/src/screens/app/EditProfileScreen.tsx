import { Ionicons } from '@expo/vector-icons';
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
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useAuthStore } from '../../store/authStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

export default function EditProfileScreen({ navigation }: any) {
  const { user, updateAccount, loading } = useAuthStore();
  const { showError, showSuccess } = useSnackbar();


  const [phone, setPhone] = useState(user?.phone ?? '');
  const [name,  setName]  = useState((user as any)?.legal_name ?? '');

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

  card: {
    backgroundColor: palette.surface,
    borderRadius:    r.lg,
    borderWidth:     1,
    borderColor:     palette.border,
    padding:         spacing.md,
    ...shadow.card,
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
    fontFamily:    'PlusJakartaSans_400Regular',
    minHeight:     48,
  },

  sep: { height: 1, backgroundColor: palette.border, marginVertical: spacing.md },

  saveBtn: {
    backgroundColor: palette.primary,
    borderRadius:    r.lg,
    paddingVertical: spacing.md,
    alignItems:      'center',
    justifyContent:  'center',
    minHeight:       52,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { ...typography.label, color: '#FFFFFF', fontSize: 15 },
});
