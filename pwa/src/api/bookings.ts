import { api } from './client';

// Communication layer + Booking Agreement — the PWA twin of the mobile
// bookingsApi comms methods, over the SAME backend. NO chat, NO VoIP and NO
// masked calling: the parties dial each other directly (the number arrives on
// the booking's `comms.contact` block, gated server-side to funded + active
// bookings), and free-form conversation deep-links to WhatsApp.

export const bookingsApi = {
  /** Send one preset status update ("On my way", etc.). */
  statusUpdate: (id: string, type: string, extra?: { duration_mins?: number }) =>
    api.post(`/bookings/${id}/status-update`, { type, ...(extra ?? {}) }, true),

  /** Short-lived signed URL to open/download the latest Booking Agreement PDF. */
  agreementLink: (id: string) =>
    api.get<{ url: string; filename: string; version: number }>(`/bookings/${id}/agreement/link`, true),
};
