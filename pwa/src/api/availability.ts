import { api } from './client';

// Provider weekly availability + time-off blocks. Writes the
// provider_availability table — the source the WhatsApp date-picker and
// dispatch eligibility read. Mirrors the mobile app's api/availability.ts.

/** 0 = Sunday … 6 = Saturday (backend Carbon dayOfWeek). */
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
    api.get<AvailabilityState>('/provider/availability', true),

  setSchedule: (slots: AvailabilitySlot[]) =>
    api.put<AvailabilityState>('/provider/availability', { slots }, true),

  blockDate: (date: string) =>
    api.post<{ blocked_dates: string[] }>('/provider/availability/blocks', { date }, true),

  unblockDate: (date: string) =>
    api.delete<{ blocked_dates: string[] }>(`/provider/availability/blocks/${date}`, true),
};
