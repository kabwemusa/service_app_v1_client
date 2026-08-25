import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import {
  Booking,
  BookingCommsOption,
  bookingsApi,
} from '../../api/bookings';
import { ApiError } from '../../api/errors';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { palette, radius as r, spacing, typography } from '../../theme';

/**
 * Provider ↔ customer communication for an active, funded booking.
 *
 * DELIBERATELY NOT a chat. Three narrow channels, all backed by ONE backend:
 *   • Call        — the other party's real number, handed straight to the OS
 *                   dialler. No proxy: a call from an unknown virtual number
 *                   doesn't get answered, which defeated the point of masking.
 *   • Status chips— tap-to-send presets ("On my way", "Arrived", …); no typing.
 *   • WhatsApp    — free-form goes to the platform's WhatsApp channel (deep-link).
 *
 * The server decides what is available (booking.comms). When contact is closed
 * (before funding / after the dispute window) `contact` is null and no number is
 * rendered — the gate is server-side, this is just the surface.
 */
export function BookingCommsSection({
  booking,
  onChanged,
}: {
  booking: Booking;
  onChanged: () => void;
}) {
  const { showError, showSuccess } = useSnackbar();
  const comms = booking.comms;

  const [busy, setBusy]       = useState(false);
  const [lateFor, setLateFor] = useState<string | null>(null); // preset awaiting a duration

  if (!comms) return null;

  const contact = comms.contact;

  const hasAnything =
    !!contact ||
    comms.status_update_options.length > 0 ||
    !!comms.agreement ||
    !!WHATSAPP_NUMBER;

  if (!hasAnything) return null;

  async function send(type: string, extra?: { duration_mins?: number }) {
    if (busy) return; // double-submit guard
    setBusy(true);
    try {
      await bookingsApi.statusUpdate(booking.id, type, extra);
      showSuccess('Update sent.');
      setLateFor(null);
      onChanged();
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Could not send the update.');
    } finally {
      setBusy(false);
    }
  }

  function onPreset(opt: BookingCommsOption) {
    if (opt.requires === 'duration') {
      setLateFor(lateFor === opt.type ? null : opt.type);
      return;
    }
    send(opt.type);
  }

  async function dial() {
    if (!contact?.phone) {
      showError('No number available for this booking yet.');
      return;
    }

    // Strip everything the dialler does not want. A stored number can carry
    // spaces or punctuation, and `tel:` with a raw space silently fails to open
    // on Android rather than throwing — which is exactly the "button does
    // nothing" symptom. Keep a leading + (E.164) and digits only.
    const dialable = contact.phone.trim().replace(/(?!^\+)[^\d]/g, '');
    const url = `tel:${dialable}`;

    try {
      // canOpenURL is the honest check: an emulator or a device with no dialler
      // app resolves nothing, and openURL would fail silently there.
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        showError(`No dialler on this device. ${contact.name}: ${contact.phone}`);
        return;
      }
      await Linking.openURL(url);
    } catch {
      showError(`Could not open the dialler. ${contact.name}: ${contact.phone}`);
    }
  }

  function copyNumber() {
    if (!contact?.phone) return;
    Clipboard.setStringAsync(contact.phone)
      .then(() => showSuccess('Number copied.'))
      .catch(() => showError('Could not copy the number.'));
  }

  async function openAgreement() {
    if (busy) return;
    setBusy(true);
    try {
      const { url } = await bookingsApi.agreementLink(booking.id);
      await Linking.openURL(url);
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Could not open the agreement.');
    } finally {
      setBusy(false);
    }
  }

  function openWhatsApp() {
    // Free-form conversation → the platform's WhatsApp channel. Pre-fills the
    // booking reference so support has context without the customer typing it.
    const ref = booking.id.slice(0, 8).toUpperCase();
    const text = encodeURIComponent(`Hi, I have a question about my booking (ref ${ref}).`);
    Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`).catch(() =>
      showError('Could not open WhatsApp.'),
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Communication</Text>

      {/* Call + WhatsApp */}
      <View style={styles.actionRow}>
        {!!contact && (
          <TouchableOpacity style={styles.action} onPress={dial} activeOpacity={0.7}>
            <Ionicons name="call" size={18} color={palette.primary} />
            <Text style={styles.actionText}>Call</Text>
          </TouchableOpacity>
        )}
        {!!WHATSAPP_NUMBER && (
          <TouchableOpacity style={styles.action} onPress={openWhatsApp} activeOpacity={0.7}>
            <Ionicons name="logo-whatsapp" size={18} color={palette.success} />
            <Text style={styles.actionText}>WhatsApp</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* The number itself — visible, not hidden behind the button, so the
          customer recognises who is calling when the provider rings back.
          Laid out as a row so the name/number column and the copy affordance
          align, instead of two stacked lines drifting left. */}
      {!!contact && (
        <View style={styles.numberRow}>
          <TouchableOpacity
            style={styles.numberMain}
            onPress={dial}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Call ${contact.name} on ${contact.phone}`}
          >
            <Text style={styles.numberLabel} numberOfLines={1}>{contact.name}</Text>
            <Text style={styles.numberValue} numberOfLines={1}>{contact.phone}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.copyBtn}
            onPress={copyNumber}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Copy number"
          >
            <Ionicons name="copy-outline" size={16} color={palette.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Status update chips */}
      {comms.status_update_options.length > 0 && (
        <>
          <Text style={styles.subhead}>Quick update</Text>
          <View style={styles.chips}>
            {comms.status_update_options.map((opt) => (
              <TouchableOpacity
                key={opt.type}
                style={[styles.chip, lateFor === opt.type && styles.chipActive]}
                onPress={() => onPreset(opt)}
                disabled={busy}
                activeOpacity={0.7}
              >
                <Text style={styles.chipText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* RUNNING_LATE — pick a duration */}
          {lateFor && (
            <View style={styles.chips}>
              {(comms.status_update_options.find((o) => o.type === lateFor)?.durations ?? []).map((m) => (
                <TouchableOpacity key={m} style={styles.durChip} disabled={busy}
                  onPress={() => send(lateFor, { duration_mins: m })} activeOpacity={0.7}>
                  <Text style={styles.durChipText}>{m} min</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      )}

      {/* Booking Agreement */}
      {comms.agreement && (
        <TouchableOpacity style={styles.agreement} onPress={openAgreement} disabled={busy} activeOpacity={0.7}>
          <Ionicons name="document-text-outline" size={18} color={palette.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.agreementTitle}>{comms.agreement.title}</Text>
            <Text style={styles.agreementSub}>Version {comms.agreement.version} · tap to download</Text>
          </View>
          <Ionicons name="download-outline" size={18} color={palette.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const WHATSAPP_NUMBER = (process.env.EXPO_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/[^0-9]/g, '');

const styles = StyleSheet.create({
  card: {
    borderWidth: 1, borderColor: palette.border, borderRadius: r.md,
    padding: spacing.md, marginBottom: spacing.md, backgroundColor: palette.surface,
  },
  title: { ...typography.label, color: palette.textPrimary, marginBottom: spacing.md },
  subhead: {
    ...typography.label, color: palette.textSecondary,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: palette.border, borderRadius: r.sm,
    paddingVertical: 12, minHeight: 44,
  },
  actionText: { ...typography.label, color: palette.textPrimary },
  // Row, not a stack: the name/number column grows and the copy button pins
  // right, so the block lines up with the Call/WhatsApp row above it.
  numberRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.sm, borderWidth: 1, borderColor: palette.border,
    borderRadius: r.sm, paddingVertical: 10, paddingHorizontal: spacing.md,
    backgroundColor: palette.background,
  },
  numberMain: { flex: 1, minWidth: 0 },
  copyBtn: { padding: 6 },
  numberLabel: { ...typography.bodySmall, color: palette.textSecondary },
  numberValue: { ...typography.label, color: palette.textPrimary, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: {
    borderWidth: 1, borderColor: palette.border, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 10, minHeight: 40,
    justifyContent: 'center', backgroundColor: palette.background,
  },
  chipActive: { borderColor: palette.primary, backgroundColor: palette.primaryLight },
  chipText: { ...typography.label, color: palette.textPrimary },
  durChip: {
    borderWidth: 1, borderColor: palette.primary, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: palette.primaryLight,
  },
  durChipText: { ...typography.label, color: palette.primary },
  agreement: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg,
    borderWidth: 1, borderColor: palette.border, borderRadius: r.sm,
    paddingVertical: 12, paddingHorizontal: spacing.md,
  },
  agreementTitle: { ...typography.label, color: palette.textPrimary },
  agreementSub: { ...typography.bodySmall, color: palette.textSecondary },
});
