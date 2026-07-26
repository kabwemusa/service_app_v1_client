import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Linking, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
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
 *   • Masked call  — routes through a proxy number; neither party sees the other's.
 *   • Status chips — tap-to-send presets ("On my way", "Arrived", …); no free typing.
 *   • WhatsApp     — free-form goes to the platform's WhatsApp channel (deep-link).
 *
 * The server decides what is available (booking.comms). When contact is closed
 * (before funding / after the dispute window) this renders nothing.
 */
export function BookingCommsSection({
  booking,
  onChanged,
}: {
  booking: Booking;
  onChanged: () => void;
}) {
  const { showError, showSuccess, showSnackbar } = useSnackbar();
  const comms = booking.comms;

  const [busy, setBusy]           = useState(false);
  const [lateFor, setLateFor]     = useState<string | null>(null); // preset type awaiting a duration
  const [noteFor, setNoteFor]     = useState<string | null>(null); // preset type awaiting a note
  const [noteText, setNoteText]   = useState('');
  const [reveal, setReveal]       = useState<{ number: string; expires: string | null } | null>(null);

  if (!comms) return null;

  const hasAnything =
    comms.call_enabled ||
    comms.status_update_options.length > 0 ||
    !!comms.agreement ||
    !!WHATSAPP_NUMBER;

  if (!hasAnything) return null;

  async function send(type: string, extra?: { duration_mins?: number; note?: string }) {
    if (busy) return; // double-submit guard
    setBusy(true);
    try {
      await bookingsApi.statusUpdate(booking.id, type, extra);
      showSuccess('Update sent.');
      setLateFor(null);
      setNoteFor(null);
      setNoteText('');
      onChanged();
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Could not send the update.');
    } finally {
      setBusy(false);
    }
  }

  function onPreset(opt: BookingCommsOption) {
    if (opt.requires === 'duration') { setNoteFor(null); setLateFor(lateFor === opt.type ? null : opt.type); return; }
    if (opt.requires === 'note')     { setLateFor(null); setNoteFor(noteFor === opt.type ? null : opt.type); return; }
    send(opt.type);
  }

  async function startCall() {
    if (busy) return;
    setBusy(true);
    setReveal(null);
    try {
      const res = await bookingsApi.call(booking.id);
      if (res.mode === 'reveal' && res.revealed_number) {
        // Flagged fallback: masking unavailable, a number is shared for a window.
        setReveal({ number: res.revealed_number, expires: res.reveal_expires_at ?? null });
        showSnackbar({ message: res.message, variant: 'info' });
      } else {
        showSnackbar({ message: res.message, variant: 'success' });
      }
    } catch (e) {
      showError(e instanceof ApiError ? e.message : 'Could not start the call.');
    } finally {
      setBusy(false);
    }
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
    // Free-form conversation → the platform's WhatsApp channel (never the other
    // party's number — anti-circumvention). Pre-fills the booking reference.
    const ref = booking.id.slice(0, 8).toUpperCase();
    const text = encodeURIComponent(`Hi, I have a question about my booking (ref ${ref}).`);
    Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`).catch(() =>
      showError('Could not open WhatsApp.'),
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Communication</Text>

      {/* Masked call + WhatsApp */}
      <View style={styles.actionRow}>
        {comms.call_enabled && (
          <TouchableOpacity style={styles.action} onPress={startCall} disabled={busy} activeOpacity={0.7}>
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

      {comms.call_enabled && (
        <Text style={styles.hint}>Calls connect through Sebenza — neither of you sees the other's number.</Text>
      )}

      {/* Reveal fallback (only when masking is unavailable) */}
      {reveal && (
        <TouchableOpacity style={styles.reveal} onPress={() => Linking.openURL(`tel:${reveal.number}`)}>
          <Ionicons name="call-outline" size={16} color={palette.warning} />
          <Text style={styles.revealText}>Tap to call {reveal.number}{reveal.expires ? ' (shared temporarily)' : ''}</Text>
        </TouchableOpacity>
      )}

      {/* Status update chips */}
      {comms.status_update_options.length > 0 && (
        <>
          <Text style={styles.subhead}>Quick update</Text>
          <View style={styles.chips}>
            {comms.status_update_options.map((opt) => (
              <TouchableOpacity
                key={opt.type}
                style={[styles.chip, (lateFor === opt.type || noteFor === opt.type) && styles.chipActive]}
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

          {/* LOCATION_NOTE — short note */}
          {noteFor && (
            <View style={styles.noteRow}>
              <TextInput
                style={styles.noteInput}
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Add a short note…"
                placeholderTextColor={palette.textDisabled}
                maxLength={comms.status_update_options.find((o) => o.type === noteFor)?.max_length ?? 200}
                multiline
              />
              <TouchableOpacity
                style={[styles.noteSend, (!noteText.trim() || busy) && styles.noteSendDisabled]}
                onPress={() => noteText.trim() && send(noteFor, { note: noteText.trim() })}
                disabled={!noteText.trim() || busy}
              >
                <Ionicons name="send" size={16} color="#fff" />
              </TouchableOpacity>
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
  title: { ...typography.label, color: palette.textPrimary, marginBottom: spacing.sm },
  subhead: { ...typography.label, color: palette.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  hint: { ...typography.bodySmall, color: palette.textSecondary, marginTop: spacing.xs },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: palette.border, borderRadius: r.sm, paddingVertical: 10,
  },
  actionText: { ...typography.label, color: palette.textPrimary },
  reveal: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm,
    backgroundColor: palette.warningLight, borderRadius: r.sm, padding: spacing.sm,
  },
  revealText: { ...typography.bodySmall, color: palette.warning, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: {
    borderWidth: 1, borderColor: palette.border, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: palette.background,
  },
  chipActive: { borderColor: palette.primary, backgroundColor: palette.primaryLight },
  chipText: { ...typography.label, color: palette.textPrimary },
  durChip: {
    borderWidth: 1, borderColor: palette.primary, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: palette.primaryLight,
  },
  durChipText: { ...typography.label, color: palette.primary },
  noteRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  noteInput: {
    flex: 1, borderWidth: 1, borderColor: palette.border, borderRadius: r.sm,
    padding: spacing.sm, color: palette.textPrimary, minHeight: 42, maxHeight: 96,
    ...typography.body,
  },
  noteSend: {
    width: 42, height: 42, borderRadius: r.sm, backgroundColor: palette.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  noteSendDisabled: { backgroundColor: palette.textDisabled },
  agreement: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md,
    borderWidth: 1, borderColor: palette.border, borderRadius: r.sm, padding: spacing.sm,
  },
  agreementTitle: { ...typography.label, color: palette.textPrimary },
  agreementSub: { ...typography.bodySmall, color: palette.textSecondary },
});
