import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text, TouchableRipple } from 'react-native-paper';
import { palette, radius as r, spacing, typography } from '../../theme';

/**
 * App-styled replacement for `Alert.alert(...)` confirmations — a centered,
 * flat white card on a dimmed backdrop (v3.1 §2 design language: no shadow,
 * no elevation, hairline border, 8px radius).
 *
 * Usage: keep a single `{ title, message, ... } | null` piece of state on the
 * screen and render one `<ConfirmDialog dialog={dialog} onDismiss={...} />`,
 * rather than a bespoke Modal per action.
 */

export interface ConfirmDialogConfig {
  title:         string;
  message:       string;
  confirmLabel?: string;
  cancelLabel?:  string;
  /** Red confirm button + danger icon accent — for destructive/irreversible actions. */
  destructive?:  boolean;
  /** Optional leading icon (defaults to help-circle / alert-circle by `destructive`). */
  icon?:         keyof typeof Ionicons.glyphMap;
  onConfirm:     () => void;
  /** Hide the Cancel button — a single-button acknowledgement dialog. */
  hideCancel?:   boolean;
}

interface Props {
  dialog:     ConfirmDialogConfig | null;
  busy?:      boolean;
  onDismiss:  () => void;
}

export function ConfirmDialog({ dialog, busy = false, onDismiss }: Props) {
  const visible = !!dialog;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.backdrop}>
        {dialog && (
          <View style={styles.card} accessibilityViewIsModal accessibilityLabel={dialog.title}>
            <View style={[styles.iconWrap, dialog.destructive && styles.iconWrapDanger]}>
              <Ionicons
                name={dialog.icon ?? (dialog.destructive ? 'alert-circle-outline' : 'help-circle-outline')}
                size={22}
                color={dialog.destructive ? palette.danger : palette.primary}
              />
            </View>

            <Text style={styles.title}>{dialog.title}</Text>
            <Text style={styles.message}>{dialog.message}</Text>

            <View style={styles.actions}>
              {!dialog.hideCancel && (
                <TouchableRipple
                  style={styles.btnSecondary}
                  onPress={onDismiss}
                  disabled={busy}
                  borderless
                  accessibilityRole="button"
                  accessibilityLabel={dialog.cancelLabel ?? 'Cancel'}
                >
                  <Text style={styles.btnSecondaryText}>{dialog.cancelLabel ?? 'Cancel'}</Text>
                </TouchableRipple>
              )}
              <TouchableRipple
                style={[
                  styles.btnPrimary,
                  dialog.destructive && styles.btnPrimaryDanger,
                  dialog.hideCancel && { flex: 1 },
                  busy && styles.btnDisabled,
                ]}
                onPress={dialog.onConfirm}
                disabled={busy}
                borderless
                accessibilityRole="button"
                accessibilityLabel={dialog.confirmLabel ?? 'Confirm'}
              >
                {busy ? (
                  <ActivityIndicator size={16} color="#fff" />
                ) : (
                  <Text style={styles.btnPrimaryText}>{dialog.confirmLabel ?? 'Confirm'}</Text>
                )}
              </TouchableRipple>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex:              1,
    backgroundColor:   'rgba(15,23,42,0.6)',
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    width:            '100%',
    maxWidth:         360,
    backgroundColor:  palette.surface,
    borderRadius:     r.md,
    borderWidth:      StyleSheet.hairlineWidth,
    borderColor:      palette.border,
    padding:          spacing.lg,
    alignItems:       'center',
  },
  iconWrap: {
    width:           40,
    height:          40,
    borderRadius:    r.full,
    backgroundColor: palette.primaryLight,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    spacing.sm,
  },
  iconWrapDanger: { backgroundColor: palette.dangerLight },

  title:   { ...typography.label, fontSize: 16, color: palette.textPrimary, textAlign: 'center' },
  message: {
    ...typography.bodySmall,
    fontSize:   14,
    lineHeight: 20,
    color:      palette.textSecondary,
    textAlign:  'center',
    marginTop:  spacing.xs,
  },

  actions: {
    flexDirection: 'row',
    gap:           spacing.sm,
    marginTop:     spacing.lg,
    width:         '100%',
  },
  btnSecondary: {
    flex:            1,
    height:          46,
    borderRadius:    r.sm,
    borderWidth:     1,
    borderColor:     palette.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  btnSecondaryText: { ...typography.label, fontSize: 14, color: palette.textSecondary },
  btnPrimary: {
    flex:            1,
    height:          46,
    borderRadius:    r.sm,
    backgroundColor: palette.primary,
    alignItems:      'center',
    justifyContent:  'center',
  },
  btnPrimaryDanger: { backgroundColor: palette.danger },
  btnDisabled:      { opacity: 0.6 },
  btnPrimaryText:   { ...typography.label, fontSize: 14, color: '#fff' },
});
