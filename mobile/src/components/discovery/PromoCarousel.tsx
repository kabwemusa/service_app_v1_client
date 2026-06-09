import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { palette, radius as r, spacing, typography } from '../../theme';

const SLIDE_W    = Dimensions.get('window').width;
const ADVANCE_MS = 3_500;

const SLIDES = [
  {
    id:    'trust',
    icon:  'shield-checkmark-outline' as const,
    title: 'Pay safely, every time',
    sub:   'Funds are held in escrow and released only when you confirm the job is done.',
    bg:    palette.primary,
    tint:  'rgba(255,255,255,0.12)',
  },
  {
    id:    'quality',
    icon:  'ribbon-outline' as const,
    title: 'Verified by us. Trusted by you.',
    sub:   'Every provider is ID-checked and rated by real customers like you.',
    bg:    '#064E3B',
    tint:  'rgba(255,255,255,0.10)',
  },
  {
    id:    'local',
    icon:  'flash-outline' as const,
    title: 'Nearby help, ready today',
    sub:   'Same-day and next-day local services at transparent, upfront prices.',
    bg:    '#1E3A5F',
    tint:  'rgba(255,255,255,0.10)',
  },
] as const;

export function PromoCarousel() {
  const scrollRef = useRef<ScrollView>(null);
  const activeRef = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const [active, setActive] = useState(0);

  const goTo = useCallback((idx: number) => {
    scrollRef.current?.scrollTo({ x: idx * SLIDE_W, animated: true });
    activeRef.current = idx;
    setActive(idx);
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      goTo((activeRef.current + 1) % SLIDES.length);
    }, ADVANCE_MS);
  }, [goTo]);

  useEffect(() => {
    startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [startTimer]);

  const handleScrollEnd = useCallback((e: { nativeEvent: { contentOffset: { x: number } } }) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SLIDE_W);
    activeRef.current = idx;
    setActive(idx);
    startTimer();
  }, [startTimer]);

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        scrollEventThrottle={32}
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        onMomentumScrollEnd={handleScrollEnd}
      >
        {SLIDES.map((slide) => (
          <View key={slide.id} style={[styles.slide, { backgroundColor: slide.bg }]}>
            {/* Decorative circle — top-right accent */}
            <View style={[styles.decor, { backgroundColor: slide.tint }]} />

            <View style={styles.content}>
              <View style={[styles.iconCircle, { backgroundColor: slide.tint }]}>
                <Ionicons name={slide.icon} size={24} color="#FFFFFF" />
              </View>
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.sub}>{slide.sub}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Dot indicators */}
      <View style={styles.dots}>
        {SLIDES.map((_, idx) => (
          <View key={idx} style={[styles.dot, active === idx ? styles.dotOn : styles.dotOff]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: {
    width:    SLIDE_W,
    overflow: 'hidden',
  },

  decor: {
    position:     'absolute',
    width:        200,
    height:       200,
    borderRadius: r.full,
    right:        -50,
    top:          -50,
  },

  content: {
    paddingHorizontal: spacing.lg,
    paddingTop:        spacing.lg,
    paddingBottom:     spacing.xl,
  },

  iconCircle: {
    width:           44,
    height:          44,
    borderRadius:    r.full,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    spacing.sm,
  },

  title: {
    ...typography.heading2,
    color:        '#FFFFFF',
    marginBottom: spacing.xs,
  },

  sub: {
    ...typography.body,
    color:    'rgba(255,255,255,0.80)',
    maxWidth: 280,
  },

  dots: {
    flexDirection:  'row',
    justifyContent: 'center',
    alignItems:     'center',
    gap:            6,
    paddingVertical: spacing.sm,
  },

  dot:    { height: 6, borderRadius: r.full },
  dotOn:  { width: 20, backgroundColor: palette.primary },
  dotOff: { width: 6,  backgroundColor: palette.skeleton },
});
