import { api } from './client';

/**
 * Provider weekly availability + time-off blocks.
 *
 * This API writes the `provider_availability` table — the single source the
 * WhatsApp date-picker, PWA date-picker and dispatch eligibility read. The
 * server mirrors writes into the legacy profile availability_matrix.
 */

/** 0 = Sunday … 6 = Saturday (matches the backend's Carbon dayOfWeek). */
export interface AvailabilitySlot {
  day_of_week: number;
  start_time:  string; // 'HH:MM'
  end_time:    string; // 'HH:MM'
}

export interface AvailabilityState {
  schedule:      AvailabilitySlot[];
  blocked_dates: string[]; // 'YYYY-MM-DD', today onward
}

export const availabilityApi = {
  get: () =>
    api.get<AvailabilityState>('/provider/availability'),

  /** Replace the entire recurring weekly schedule. */
  setSchedule: (slots: AvailabilitySlot[]) =>
    api.put<AvailabilityState>('/provider/availability', { slots }),

  /** Block a specific date (time off). */
  blockDate: (date: string) =>
    api.post<{ blocked_dates: string[] }>('/provider/availability/blocks', { date }),

  /** Remove a time-off block. */
  unblockDate: (date: string) =>
    api.delete<{ blocked_dates: string[] }>(`/provider/availability/blocks/${date}`),
};
