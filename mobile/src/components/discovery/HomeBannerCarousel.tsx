import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { bannersApi, HomeBanner } from '../../api/banners';
import { palette, radius as r, spacing } from '../../theme';
import { fontFamily } from '../../theme/typography';

const SCREEN_W      = Dimensions.get('window').width;
const PEEK          = 32;                       // px visible from each adjacent card
const CARD_GAP      = 10;                       // px between cards
const CARD_W        = SCREEN_W - PEEK * 2;
const CARD_H        = Math.round(CARD_W * 0.52);
const SNAP_INTERVAL = CARD_W + CARD_GAP;
const ADVANCE_MS    = 5_000;

const BG_TOKENS: Record<string, string> = {
  primary: palette.primary,
  success: palette.success,
  info:    '#1E3A5F',
  neutral: '#374151',
};

export function HomeBannerCarousel({
  onAction,
  refreshKey,
}: {
  onAction?: (action: string) => void;
  /** Change this to force a re-fetch (e.g. on a live campaign change). */
  refreshKey?: number;
}) {
  const scrollRef  = useRef<ScrollView>(null);
  const activeRef  = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const bannersRef = useRef<HomeBanner[]>([]);

  const [banners, setBanners]   = useState<HomeBanner[]>([]);
  const [status, setStatus]     = useState<'loading' | 'ready' | 'empty'>('loading');
  const [active, setActive]     = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    bannersApi
      .list()
      .then((data) => {
        if (!alive) return;
        if (data.length === 0) { setStatus('empty'); return; }
        const sliced = data.slice(0, 6);
        bannersRef.current = sliced;
        setBanners(sliced);
        setStatus('ready');
      })
      .catch(() => { if (alive) setStatus('empty'); });
    return () => { alive = false; };
  }, [refreshKey]);

  const goTo = useCallback(
    (idx: number) => {
      scrollRef.current?.scrollTo({ x: idx * SNAP_INTERVAL, animated: !reducedMotion });
      activeRef.current = idx;
      setActive(idx);
    },
    [reducedMotion],
  );

  // Auto-advance always runs with 2+ banners — "reduce motion" changes HOW the
  // transition looks (goTo already passes animated: !reducedMotion for an
  // instant snap instead of a slide), never WHETHER the carousel moves at all.
  const startTimer = useCallback(() => {
    if (bannersRef.current.length <= 1) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      goTo((activeRef.current + 1) % bannersRef.current.length);
    }, ADVANCE_MS);
  }, [goTo]);

  useEffect(() => {
    if (status === 'ready') startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status, startTimer]);

  if (status === 'empty') return null;

  if (status === 'loading') {
    return <View style={styles.skeleton} />;
  }

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP_INTERVAL}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={styles.scrollContent}
        onScrollBeginDrag={() => {
          if (timerRef.current) clearInterval(timerRef.current);
        }}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SNAP_INTERVAL);
          activeRef.current = idx;
          setActive(idx);
          startTimer();
        }}
      >
        {banners.map((banner) => {
          const bgColor = BG_TOKENS[banner.bg_token ?? ''] ?? palette.primary;
          const hasCta  = Boolean(banner.cta_action && onAction);

          return (
            <TouchableOpacity
              key={banner.id}
              activeOpacity={hasCta ? 0.88 : 1}
              onPress={hasCta ? () => onAction!(banner.cta_action!) : undefined}
              accessibilityRole={hasCta ? 'button' : 'image'}
              accessibilityLabel={banner.title}
              style={styles.cardOuter}
            >
              <View style={[styles.card, { backgroundColor: bgColor }]}>
                {/* Photo background */}
                {banner.image_url ? (
                  <Image
                    source={{ uri: banner.image_url }}
                    style={StyleSheet.absoluteFillObject}
                    contentFit="cover"
                  />
                ) : null}

                {/* Gradient for text contrast */}
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.58)']}
                  locations={[0.2, 1]}
                  style={StyleSheet.absoluteFillObject}
                />

                {/* Decorative circle top-right */}
                <View style={styles.circle} />

                {/* Content */}
                <View style={styles.content}>
                  <Text style={styles.title} numberOfLines={2}>{banner.title}</Text>
                  {banner.subtitle ? (
                    <Text style={styles.sub} numberOfLines={2}>{banner.subtitle}</Text>
                  ) : null}
                  {banner.cta_label ? (
                    <View style={styles.ctaPill}>
                      <Text style={[styles.ctaTxt, { color: bgColor }]}>
                        {banner.cta_label}
                      </Text>
                      <Ionicons name="arrow-forward" size={11} color={bgColor} />
                    </View>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Dot indicators — overlaid, fixed (don't scroll with cards) */}
      {banners.length > 1 && (
        <View style={styles.dotsOverlay} pointerEvents="none">
          {banners.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === active ? styles.dotOn : styles.dotOff]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: CARD_H },

  skeleton: {
    height:          CARD_H,
    marginHorizontal: PEEK,
    borderRadius:    r.sm,
    backgroundColor: palette.skeleton,
  },

  scrollContent: { paddingHorizontal: PEEK },

  cardOuter: { marginRight: CARD_GAP },
  card: {
    width:        CARD_W,
    height:       CARD_H,
    borderRadius: r.sm,
    overflow:     'hidden',
  },

  circle: {
    position:        'absolute',
    width:           130,
    height:          130,
    borderRadius:    65,
    top:             -35,
    right:           -25,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },

  content: {
    position:          'absolute',
    bottom:            0,
    left:              0,
    right:             0,
    paddingHorizontal: spacing.md,
    paddingBottom:     spacing.md + 2,
    paddingTop:        spacing.xl,
  },
  title: {
    fontFamily:   fontFamily.bold,
    fontSize:     18,
    lineHeight:   24,
    color:        '#fff',
    marginBottom: 3,
  },
  sub: {
    fontFamily:   fontFamily.regular,
    fontSize:     12,
    lineHeight:   17,
    color:        'rgba(255,255,255,0.85)',
    marginBottom: spacing.xs + 2,
  },
  ctaPill: {
    flexDirection:     'row',
    alignItems:        'center',
    alignSelf:         'flex-start',
    gap:               4,
    backgroundColor:   '#fff',
    borderRadius:      r.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical:   5,
  },
  ctaTxt: {
    fontFamily: fontFamily.medium,
    fontSize:   12,
  },

  dotsOverlay: {
    position:       'absolute',
    bottom:         spacing.sm + 2,
    left:           0,
    right:          0,
    flexDirection:  'row',
    justifyContent: 'center',
    alignItems:     'center',
    gap:            4,
  },
  dot:    { height: 5, borderRadius: r.full },
  dotOn:  { width: 18, backgroundColor: 'rgba(255,255,255,0.95)' },
  dotOff: { width:  5, backgroundColor: 'rgba(255,255,255,0.40)' },
});
