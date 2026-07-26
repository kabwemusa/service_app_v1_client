import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import { ActivityIndicator, Text, TouchableRipple } from 'react-native-paper';
import { palette, radius as r, spacing, typography } from '../../theme';
import { fontFamily } from '../../theme/typography';

/**
 * "Pay & hold funds" confirmation — an app-styled dialog (replacing a plain
 * Alert.alert) that lets the buyer see and approve the Mobile Money number
 * the collection request goes to, or enter a different one.
 *
 *   • Account has a phone on file  → show it, offer "Use a different number"
 *   • No phone on file             → go straight to the number entry step
 */

/** Normalise typed input to +260XXXXXXXXX, or null if not a valid Zambian mobile number. */
function normalizeZambianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  let subscriber = digits;
  if (digits.startsWith('260')) subscriber = digits.slice(3);
  else if (digits.startsWith('0')) subscriber = digits.slice(1);

  if (subscriber.length !== 9 || !/^[79]/.test(subscriber)) return null;
  return `+260${subscriber}`;
}

/** +260971234567 → "+260 97 123 4567" for easier visual scanning. */
function formatPhoneDisplay(phone: string): string {
  const m = phone.match(/^\+260(\d{2})(\d{3})(\d{4})$/);
  return m ? `+260 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

interface Props {
  visible:       boolean;
  onClose:       () => void;
  /** Buyer's account phone, if any — shown as the default payer number. */
  accountPhone:  string | null;
  title:         string;
  /** e.g. "ZMW 367.50" — rendered above the number step. */
  amountLabel:   string;
  helperText?:   string;
  confirmLabel?: string;
  busy?:         boolean;
  onConfirm:     (momoNumber?: string) => void;
}

export function PaymentConfirmDialog({
  visible, onClose, accountPhone, title, amountLabel, helperText,
  confirmLabel = 'Send payment request', busy = false, onConfirm,
}: Props) {
  const [mode, setMode]   = useState<'default' | 'edit'>(accountPhone ? 'default' : 'edit');
  const [input, setInput] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (visible) {
      setMode(accountPhone ? 'default' : 'edit');
      setInput('');
      setTouched(false);
    }
  }, [visible, accountPhone]);

  const normalized = normalizeZambianPhone(input);
  const showError   = touched && input.length > 0 && !normalized;

  function handleConfirm() {
    if (mode === 'default') {
      onConfirm(undefined); // use the account phone — no override needed
      return;
    }
    setTouched(true);
    if (normalized) onConfirm(normalized);
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
      >
        <View style={styles.card} accessibilityViewIsModal accessibilityLabel={title}>
          <View style={styles.iconWrap}>
            <Ionicons name="phone-portrait-outline" size={22} color={palette.primary} />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.amount}>{amountLabel}</Text>
          {!!helperText && <Text style={styles.helper}>{helperText}</Text>}

          {mode === 'default' && accountPhone ? (
            <>
              <View style={styles.numberRow}>
                <Ionicons name="call-outline" size={16} color={palette.textSecondary} />
                <Text style={styles.numberText}>{formatPhoneDisplay(accountPhone)}</Text>
              </View>
              <Text style={styles.helper}>
                We'll send a Mobile Money prompt to this number. Approve it on your phone to pay.
              </Text>

              <TouchableRipple
                onPress={() => setMode('edit')}
                disabled={busy}
                borderless
                style={styles.linkBtn}
                accessibilityRole="button"
                accessibilityLabel="Use a different number"
              >
                <Text style={styles.linkText}>Use a different number</Text>
              </TouchableRipple>
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Mobile Money number</Text>
              <TextInput
                style={[styles.input, showError && styles.inputError]}
                value={input}
                onChangeText={(v) => { setInput(v); setTouched(false); }}
                onBlur={() => setTouched(true)}
                placeholder="e.g. 0977123456"
                placeholderTextColor={palette.textDisabled}
                keyboardType="phone-pad"
                returnKeyType="done"
                onSubmitEditing={handleConfirm}
                autoFocus
                accessibilityLabel="Mobile Money number"
              />
              {showError ? (
                <Text style={styles.errorText}>Enter a valid Zambian number, e.g. 0977123456.</Text>
              ) : (
                <Text style={styles.helper}>MTN, Airtel or Zamtel — we'll send the payment prompt here.</Text>
              )}

              {accountPhone && (
                <TouchableRipple
                  onPress={() => { setMode('default'); setInput(''); setTouched(false); }}
                  disabled={busy}
                  borderless
                  style={styles.linkBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Use my account number ${formatPhoneDisplay(accountPhone)} instead`}
                >
                  <Text style={styles.linkText}>Use my number ({formatPhoneDisplay(accountPhone)})</Text>
                </TouchableRipple>
              )}
            </>
          )}

          <View style={styles.actions}>
            <TouchableRipple
              style={styles.btnSecondary}
              onPress={onClose}
              disabled={busy}
              borderless
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </TouchableRipple>
            <TouchableRipple
              style={[
                styles.btnPrimary,
                (busy || (mode === 'edit' && !normalized && touched)) && styles.btnDisabled,
              ]}
              onPress={handleConfirm}
              disabled={busy}
              borderless
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
            >
              {busy ? (
                <ActivityIndicator size={16} color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
              )}
            </TouchableRipple>
          </View>
        </View>
      </KeyboardAvoidingView>
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
    width:           '100%',
    maxWidth:        380,
    backgroundColor: palette.surface,
    borderRadius:    r.md,
    borderWidth:     StyleSheet.hairlineWidth,
    borderColor:     palette.border,
    padding:         spacing.lg,
    alignItems:      'center',
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

  title:  { ...typography.label, fontSize: 16, color: palette.textPrimary, textAlign: 'center' },
  amount: { ...typography.heading2, fontSize: 22, color: palette.primary, marginTop: 4 },
  helper: {
    ...typography.bodySmall, fontSize: 13, lineHeight: 18,
    color: palette.textSecondary, textAlign: 'center', marginTop: spacing.xs,
  },

  numberRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing.xs,
    backgroundColor:   palette.background,
    borderRadius:      r.sm,
    borderWidth:       1,
    borderColor:       palette.border,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm + 2,
    marginTop:         spacing.md,
    alignSelf:         'stretch',
    justifyContent:    'center',
  },
  numberText: { ...typography.body, fontFamily: fontFamily.medium, fontSize: 16, color: palette.textPrimary },

  fieldLabel: { ...typography.label, fontSize: 13, color: palette.textSecondary, alignSelf: 'flex-start', marginTop: spacing.md },
  input: {
    alignSelf:         'stretch',
    backgroundColor:   palette.background,
    borderRadius:      r.sm,
    borderWidth:       1,
    borderColor:       palette.border,
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm + 2,
    marginTop:         spacing.xs,
    fontFamily:        fontFamily.regular,
    fontSize:          16,
    color:             palette.textPrimary,
  },
  inputError: { borderColor: palette.danger },
  errorText:  { ...typography.bodySmall, fontSize: 12, color: palette.danger, alignSelf: 'flex-start', marginTop: 4 },

  linkBtn:  { marginTop: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs, borderRadius: r.sm },
  linkText: { ...typography.label, fontSize: 13, color: palette.primary },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, width: '100%' },
  btnSecondary: {
    flex: 1, height: 46, borderRadius: r.sm,
    borderWidth: 1, borderColor: palette.border,
    alignItems: 'center', justifyContent: 'center',
  },
  btnSecondaryText: { ...typography.label, fontSize: 14, color: palette.textSecondary },
  btnPrimary: {
    flex: 1, height: 46, borderRadius: r.sm,
    backgroundColor: palette.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled:    { opacity: 0.6 },
  btnPrimaryText: { ...typography.label, fontSize: 14, color: '#fff' },
});
