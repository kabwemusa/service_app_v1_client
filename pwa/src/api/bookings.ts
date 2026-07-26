import { api } from './client';

// Communication layer + Booking Agreement — the PWA twin of the mobile
// bookingsApi comms methods, over the SAME backend. NO chat / VoIP: free-form
// conversation deep-links to WhatsApp. Real phone numbers are never returned in
// bridge mode.

export interface CallSessionResult {
  session_id:         string;
  mode:               'bridge' | 'reveal';
  status:             string;
  masked_number:      string | null;
  message:            string;
  revealed_number?:   string;      // flagged reveal fallback only
  reveal_expires_at?: string;
}

export const bookingsApi = {
  /** Send one preset status update ("On my way", etc.). */
  statusUpdate: (id: string, type: string, extra?: { duration_mins?: number; note?: string }) =>
    api.post(`/bookings/${id}/status-update`, { type, ...(extra ?? {}) }, true),

  /** Start a masked voice call to the other party (numbers never returned in bridge mode). */
  call: (id: string) =>
    api.post<CallSessionResult>(`/bookings/${id}/call`, {}, true),

  /** Short-lived signed URL to open/download the latest Booking Agreement PDF. */
  agreementLink: (id: string) =>
    api.get<{ url: string; filename: string; version: number }>(`/bookings/${id}/agreement/link`, true),
};
