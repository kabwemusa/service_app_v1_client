import { create } from "zustand";

/**
 * Live-connection state + a "something changed" signal screens can react to.
 *
 * `bookingRevision` bumps every time a booking-related realtime event arrives;
 * booking list/detail screens depend on it to refetch instantly (no reload).
 * `lastBookingId` lets a detail screen refetch only when ITS booking changed.
 */
interface RealtimeState {
  connected: boolean;
  bookingRevision: number;
  lastBookingId: string | null;
  /** Bumps when a Growth & Promotions campaign changes — home/search refetch placements. */
  placementRevision: number;

  setConnected: (v: boolean) => void;
  pingBooking: (bookingId: string | null) => void;
  pingPlacements: () => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  connected: false,
  bookingRevision: 0,
  lastBookingId: null,
  placementRevision: 0,

  setConnected: (v) => set({ connected: v }),
  pingBooking: (bookingId) =>
    set((s) => ({
      bookingRevision: s.bookingRevision + 1,
      lastBookingId: bookingId,
    })),
  pingPlacements: () => set((s) => ({ placementRevision: s.placementRevision + 1 })),
}));
