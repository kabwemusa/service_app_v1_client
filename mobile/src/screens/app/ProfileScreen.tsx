import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Divider, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

interface MenuItemProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
}

function MenuItem({ icon, label, onPress, danger }: MenuItemProps) {
  return (
    <TouchableRipple onPress={onPress} borderless style={styles.menuItem}>
      <View style={styles.menuItemInner}>
        <Ionicons name={icon} size={20} color={danger ? palette.danger : palette.textSecondary} />
        <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
        <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
      </View>
    </TouchableRipple>
  );
}

export default function ProfileScreen({ navigation }: any) {
  const { logout, user } = useAuthStore();
  const insets = useSafeAreaInsets();

  const isProvider = user?.role === 'PROVIDER';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 104 }]}
      >
        <LinearGradient
          colors={['#1E63E9', '#1D8A72']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.avatar}>
            <Ionicons name="person-outline" size={36} color="#FFFFFF" />
          </View>
          <Text style={styles.nameText}>Your Account</Text>
          <Text style={styles.roleText}>{isProvider ? 'Provider' : 'Customer'}</Text>
          {!!user?.email && <Text style={styles.emailText}>{user.email}</Text>}
        </LinearGradient>

        {isProvider && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Provider Tools</Text>
            <View style={styles.card}>
              <MenuItem
                icon="construct-outline"
                label="My Services"
                onPress={() => navigation.navigate('MyServices')}
              />
              <Divider />
              <MenuItem
                icon="person-circle-outline"
                label="Provider Profile"
                onPress={() => navigation.navigate('ProviderSetup')}
              />
              <Divider />
              <MenuItem
                icon="shield-checkmark-outline"
                label="Identity Verification"
                onPress={() => navigation.navigate('Kyc')}
              />
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.card}>
            <MenuItem
              icon="notifications-outline"
              label="Notifications"
              onPress={() => {}}
            />
            <Divider />
            <MenuItem
              icon="help-circle-outline"
              label="Help & Support"
              onPress={() => {}}
            />
            <Divider />
            <MenuItem
              icon="log-out-outline"
              label="Log Out"
              onPress={logout}
              danger
            />
          </View>
        </View>

        <Text style={styles.version}>Sebenza v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  hero: {
    borderRadius: r.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  avatar: {
    width: 78,
    height: 78,
    borderRadius: r.full,
    backgroundColor: '#FFFFFF33',
    borderWidth: 1,
    borderColor: '#FFFFFF40',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  nameText: {
    ...typography.heading3,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  roleText: {
    ...typography.bodySmall,
    color: '#E9F5FF',
  },
  emailText: {
    ...typography.bodySmall,
    color: '#D9EAFF',
    marginTop: 2,
  },

  section: { marginBottom: spacing.lg },
  sectionLabel: {
    ...typography.label,
    color: palette.textSecondary,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
    ...shadow.card,
  },
  menuItem: {},
  menuItemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  menuLabel: { ...typography.body, color: palette.textPrimary, flex: 1 },
  menuLabelDanger: { color: palette.danger },
  version: {
    ...typography.bodySmall,
    color: palette.textDisabled,
    textAlign: 'center',
  },
});
