import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native';
import { useNotificationStore } from '../../store/notificationStore';
import { palette } from '../../theme';

export function NotificationBell({ color }: { color?: string }) {
  const nav = useNavigation<any>();
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  return (
    <Pressable
      onPress={() => nav.navigate('Notifications')}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      style={styles.wrap}
    >
      <Ionicons name="notifications-outline" size={22} color={color ?? palette.textPrimary} />
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {unreadCount > 99 ? '99+' : String(unreadCount)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: palette.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 9,
    color: '#fff',
    lineHeight: 12,
  },
});
