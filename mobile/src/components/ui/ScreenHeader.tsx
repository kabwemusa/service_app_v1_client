import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { palette, spacing, typography } from '../../theme';
import { fontFamily } from '../../theme/typography';

interface Props {
  title:      string;
  /** Show back arrow — true for pushed screens, false for tab roots. */
  back?:      boolean;
  /** Optional right-side element (bell, add button, gear, etc.). */
  right?:     React.ReactNode;
  /** Optional subtitle below the title. */
  subtitle?:  string;
  /** Override back handler (defaults to navigation.goBack). */
  onBack?:    () => void;
}

export function ScreenHeader({ title, back = false, right, subtitle, onBack }: Props) {
  const nav = useNavigation();

  return (
    <View style={styles.header}>
      {back ? (
        <Pressable
          onPress={onBack ?? (() => nav.goBack())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={palette.textPrimary} />
        </Pressable>
      ) : (
        <View style={styles.spacer} />
      )}

      <View style={[styles.titleWrap, !back && styles.titleWrapRoot]}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      <View style={styles.rightSlot}>
        {right ?? null}
      </View>
    </View>
  );
}

const HAIRLINE = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 52,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: palette.border,
    backgroundColor: palette.surface,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.xs,
  },
  spacer: { width: spacing.xs },
  titleWrap: {
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  titleWrapRoot: {
    marginLeft: spacing.xs,
  },
  title: {
    fontFamily: fontFamily.semiBold,
    fontSize: 18,
    color: palette.textPrimary,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: palette.textSecondary,
    marginTop: 1,
  },
  rightSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
