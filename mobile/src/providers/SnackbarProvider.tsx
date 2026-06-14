import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, spacing } from '../theme';
import { fontFamily } from '../theme/typography';

// ── Types ─────────────────────────────────────────────────────────────────────

type SnackbarVariant = 'error' | 'success' | 'info';

interface SnackbarOptions {
  message:   string;
  variant?:  SnackbarVariant;
  duration?: number;
}

interface SnackbarContextValue {
  showSnackbar: (options: SnackbarOptions) => void;
  showError:    (message: string) => void;
  showSuccess:  (message: string) => void;
}

// ── Config ────────────────────────────────────────────────────────────────────

const VARIANT_CONFIG: Record<SnackbarVariant, { bg: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  error:   { bg: palette.danger,  icon: 'alert-circle'        },
  success: { bg: palette.success, icon: 'checkmark-circle'    },
  info:    { bg: palette.primary, icon: 'information-circle'  },
};

// ── Context ───────────────────────────────────────────────────────────────────

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();

  const [message, setMessage] = useState('');
  const [variant, setVariant] = useState<SnackbarVariant>('info');
  const [mounted, setMounted] = useState(false);

  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity    = useRef(new Animated.Value(0)).current;
  const hideTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 0,    duration: 200, useNativeDriver: true }),
    ]).start(() => setMounted(false));
  }, [translateY, opacity]);

  const showSnackbar = useCallback(
    ({ message, variant = 'info', duration = 4000 }: SnackbarOptions) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);

      setMessage(message);
      setVariant(variant);
      setMounted(true);

      // Reset position then spring in from above
      translateY.setValue(-120);
      opacity.setValue(0);

      Animated.parallel([
        Animated.spring(translateY, {
          toValue:   0,
          tension:   80,
          friction:  10,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue:  1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();

      hideTimer.current = setTimeout(hide, duration);
    },
    [hide, translateY, opacity],
  );

  const showError   = useCallback((msg: string) => showSnackbar({ message: msg, variant: 'error'   }), [showSnackbar]);
  const showSuccess = useCallback((msg: string) => showSnackbar({ message: msg, variant: 'success' }), [showSnackbar]);

  const cfg = VARIANT_CONFIG[variant];

  return (
    <SnackbarContext.Provider value={{ showSnackbar, showError, showSuccess }}>
      {children}

      {mounted && (
        <Portal>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.toast,
              {
                top:             insets.top + spacing.sm,
                backgroundColor: cfg.bg,
                transform:       [{ translateY }],
                opacity,
              },
            ]}
          >
            <Ionicons name={cfg.icon} size={18} color="#FFFFFF" style={styles.icon} />
            <Text style={styles.text} numberOfLines={4}>
              {message}
            </Text>
          </Animated.View>
        </Portal>
      )}
    </SnackbarContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSnackbar(): SnackbarContextValue {
  const ctx = useContext(SnackbarContext);
  if (!ctx) throw new Error('useSnackbar must be used inside <SnackbarProvider>');
  return ctx;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  toast: {
    position:          'absolute',
    left:              spacing.md,
    right:             spacing.md,
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius:      14,
    zIndex:            9999,
    // Shadow
    shadowColor:    '#000',
    shadowOffset:   { width: 0, height: 4 },
    shadowOpacity:  0.18,
    shadowRadius:   8,
    elevation:      10,
  },
  icon: {
    marginRight: spacing.xs,
    flexShrink:  0,
  },
  text: {
    flex:        1,
    color:       '#FFFFFF',
    fontFamily:  fontFamily.medium,
    fontSize:    14,
    lineHeight:  20,
  },
});
