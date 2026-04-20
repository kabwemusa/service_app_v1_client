import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { palette, radius as r, spacing } from '../../theme';

interface Props {
  width:   number | `${number}%`;
  height:  number;
  radius?: number;
  style?:  StyleProp<ViewStyle>;
}

export function SkeletonBlock({ width, height, radius = r.sm, style }: Props) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, overflow: 'hidden', opacity },
        style,
      ]}
    >
      <LinearGradient
        colors={[palette.skeleton, palette.skeletonShimmer, palette.skeleton]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

/** Pre-built skeleton for a generic card - used on lists while loading. */
export function CardSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.row}>
        <SkeletonBlock width={48} height={48} radius={r.full} />
        <View style={styles.lines}>
          <SkeletonBlock width="70%" height={14} />
          <View style={{ height: spacing.xs }} />
          <SkeletonBlock width="45%" height={12} />
        </View>
      </View>
      <View style={{ height: spacing.sm }} />
      <SkeletonBlock width="100%" height={12} />
      <View style={{ height: spacing.xs }} />
      <SkeletonBlock width="80%" height={12} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding:         spacing.md,
    borderRadius:    r.md,
    backgroundColor: palette.surface,
    marginBottom:    spacing.sm,
  },
  row:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lines: { flex: 1 },
});
