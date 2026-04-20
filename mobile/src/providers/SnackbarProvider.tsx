import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Snackbar } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, shadow, spacing } from '../theme';

type SnackbarVariant = 'error' | 'success' | 'info';

interface SnackbarOptions {
  message: string;
  variant?: SnackbarVariant;
  duration?: number;
}

interface SnackbarContextValue {
  showSnackbar: (options: SnackbarOptions) => void;
  showError:   (message: string) => void;
  showSuccess: (message: string) => void;
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

const VARIANT_COLORS: Record<SnackbarVariant, string> = {
  error:   palette.danger,
  success: palette.success,
  info:    palette.primary,
};

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible]   = useState(false);
  const [message, setMessage]   = useState('');
  const [variant, setVariant]   = useState<SnackbarVariant>('info');
  const [duration, setDuration] = useState(4000);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSnackbar = useCallback(({ message, variant = 'info', duration = 4000 }: SnackbarOptions) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMessage(message);
    setVariant(variant);
    setDuration(duration);
    setVisible(true);
  }, []);

  const showError   = useCallback((msg: string) => showSnackbar({ message: msg, variant: 'error' }), [showSnackbar]);
  const showSuccess = useCallback((msg: string) => showSnackbar({ message: msg, variant: 'success' }), [showSnackbar]);
  // Floating tab bar occupies 68 (height) + 16 (marginBottom) = 84dp above the safe-area edge.
  // Snackbar must clear that on both iOS and Android (gesture or 3-button nav).
  const TAB_BAR_FOOTPRINT = 84;
  const bottomOffset = insets.bottom + TAB_BAR_FOOTPRINT + spacing.sm;

  return (
    <SnackbarContext.Provider value={{ showSnackbar, showError, showSuccess }}>
      {children}
      <Snackbar
        visible={visible}
        onDismiss={() => setVisible(false)}
        duration={duration}
        style={[
          styles.snackbar,
          { backgroundColor: VARIANT_COLORS[variant], marginBottom: bottomOffset },
        ]}
        wrapperStyle={styles.wrapper}
      >
        {message}
      </Snackbar>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): SnackbarContextValue {
  const ctx = useContext(SnackbarContext);
  if (!ctx) throw new Error('useSnackbar must be used inside <SnackbarProvider>');
  return ctx;
}

const styles = StyleSheet.create({
  wrapper:  { paddingHorizontal: spacing.md },
  snackbar: {
    borderRadius: 16,
    marginHorizontal: 0,
    ...shadow.card,
  },
});
