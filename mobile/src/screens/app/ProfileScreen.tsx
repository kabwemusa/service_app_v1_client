import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text, TouchableRipple } from "react-native-paper";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { storageUrl } from "../../api/client";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { useSnackbar } from "../../providers/SnackbarProvider";
import { useAuthStore } from "../../store/authStore";
import { palette, radius as r, spacing, typography } from "../../theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function initials(value?: string | null): string {
  if (!value) return "";
  const local = value.split("@")[0];
  const parts = local.split(/[.\s_-]+/).filter(Boolean);
  const take = parts.length >= 2 ? [parts[0], parts[1]] : [local];
  return take.map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

// ── Row primitive (mirrors ProviderAccountScreen for a consistent language) ──
function Row({
  icon,
  label,
  sub,
  value,
  onPress,
  danger,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      borderless
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
    >
      <View style={styles.row}>
        <View
          style={[
            styles.iconChip,
            { backgroundColor: danger ? palette.dangerLight : palette.primaryLight },
          ]}
        >
          <Ionicons
            name={icon}
            size={18}
            color={danger ? palette.danger : palette.primary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.rowLabel, danger && { color: palette.danger }]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {sub && (
            <Text style={styles.rowSub} numberOfLines={2}>
              {sub}
            </Text>
          )}
        </View>
        {value && (
          <Text style={styles.rowValue} numberOfLines={1}>
            {value}
          </Text>
        )}
        {onPress && (
          <Ionicons name="chevron-forward" size={16} color={palette.textDisabled} />
        )}
      </View>
    </TouchableRipple>
  );
}

function Divider({ inset }: { inset?: boolean }) {
  return <View style={[styles.divider, inset && styles.dividerInset]} />;
}

export default function ProfileScreen({ navigation }: any) {
  const { logout, user, activeRole, setActiveRole } = useAuthStore();
  const { showSnackbar } = useSnackbar();
  const insets = useSafeAreaInsets();

  // v3 §2.1 — a PROVIDER-role account can both buy and sell on one account;
  // `activeRole` is purely a UI-mode toggle. `role` itself never changes here.
  const canSwitchRoles = user?.role === "PROVIDER";

  // Display name takes over from the raw identifier everywhere identity shows.
  const legalName = user?.legal_name?.trim() || null;
  const identity = legalName ?? user?.email ?? user?.phone ?? "Your account";
  const roleLabel = canSwitchRoles ? "Customer & provider" : "Customer";
  const contactLine = legalName ? user?.email ?? user?.phone ?? null : null;
  const subLine = [contactLine, roleLabel].filter(Boolean).join(" · ");
  const avatarInitials = initials(legalName ?? user?.email ?? user?.phone);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const soon = (what: string) => () =>
    showSnackbar({
      message: `${what} is coming soon — we'll let you know when it launches.`,
    });

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScreenHeader title="Profile" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 104 },
        ]}
      >
        {/* ── Header: avatar + identity ── */}
        <View style={styles.header}>
          <TouchableRipple
            onPress={() => navigation.navigate("EditProfile")}
            borderless
            style={styles.avatar}
            accessibilityRole="button"
            accessibilityLabel="Edit profile photo"
          >
            {user?.avatar_url && !avatarFailed ? (
              <Image
                source={{ uri: storageUrl(user.avatar_url) }}
                style={styles.avatarImg}
                contentFit="cover"
                onError={() => setAvatarFailed(true)}
              />
            ) : avatarInitials ? (
              <Text style={styles.avatarText}>{avatarInitials}</Text>
            ) : (
              <Ionicons name="person" size={30} color={palette.primary} />
            )}
          </TouchableRipple>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>
              {identity}
            </Text>
            <Text style={styles.roleSub} numberOfLines={1}>
              {subLine}
            </Text>
          </View>
        </View>

        {/* ── Account ── */}
        <View style={styles.section}>
          <Text style={styles.groupLabel}>Account</Text>
          <View style={styles.card}>
            <Row
              icon="person-circle-outline"
              label="Edit profile"
              sub="Name & phone number"
              onPress={() => navigation.navigate("EditProfile")}
            />
            <Divider inset />
            <Row
              icon="location-outline"
              label="Saved places"
              sub="Home, work & other locations"
              onPress={() => navigation.navigate("SavedLocations")}
            />
            {canSwitchRoles && (
              <>
                <Divider inset />
                <Row
                  icon="shield-checkmark-outline"
                  label="Identity verification"
                  sub="Manage your ID & clearances"
                  onPress={() => navigation.navigate("Kyc")}
                />
              </>
            )}
          </View>
        </View>

        {/* ── Settings ── */}
        <View style={styles.section}>
          <Text style={styles.groupLabel}>Settings</Text>
          <View style={styles.card}>
            <Row
              icon="notifications-outline"
              label="Notifications"
              onPress={() => navigation.navigate("NotificationSettings")}
            />
            <Divider inset />
            <Row
              icon="help-circle-outline"
              label="Help & support"
              onPress={soon("Help & support")}
            />
            <Divider inset />
            <Row
              icon="lock-closed-outline"
              label="Privacy & consent"
              sub="Manage consent & your data rights"
              onPress={() => navigation.navigate("PrivacyConsent")}
            />
            <Divider inset />
            <Row
              icon="document-text-outline"
              label="Legal & policies"
              sub="Terms, Privacy Policy & User Agreement"
              onPress={() => navigation.navigate("Legal")}
            />
            {canSwitchRoles && (
              <>
                <Divider inset />
                <Row
                  icon="swap-horizontal-outline"
                  label="Switch to provider"
                  sub="Show your Hub, jobs, services & earnings"
                  onPress={() => setActiveRole("PROVIDER")}
                />
              </>
            )}
            <Divider inset />
            <Row icon="log-out-outline" label="Sign out" onPress={logout} danger />
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

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: {
    width: "100%",
    height: "100%",
  },
  avatarText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 22,
    color: palette.primary,
  },
  name: { ...typography.heading3, fontSize: 19, color: palette.textPrimary },
  roleSub: {
    ...typography.bodySmall,
    fontSize: 13,
    color: palette.textSecondary,
    marginTop: 2,
  },

  // Sections
  section: { marginBottom: spacing.lg },
  groupLabel: {
    ...typography.label,
    fontSize: 13,
    color: palette.textSecondary,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: r.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
  },

  // Rows
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.xs,
  },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: r.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { ...typography.body, fontSize: 16, color: palette.textPrimary },
  rowSub: { ...typography.bodySmall, fontSize: 12, color: palette.textSecondary, marginTop: 1 },
  rowValue: { ...typography.bodySmall, fontSize: 13, color: palette.textSecondary },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border },
  dividerInset: { marginLeft: 38 + spacing.md }, // icon chip + gap → aligns with row text

  version: {
    ...typography.bodySmall,
    color: palette.textDisabled,
    textAlign: "center",
  },
});
