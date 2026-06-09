import { create } from 'zustand';
import { ApiError } from '../api/errors';
import { Booking, CreateBookingParams, IncomingRequests, OpenDisputeParams, PaginatedBookings, bookingsApi } from '../api/bookings';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

interface BookingState {
  bookings:    Booking[];
  page:        number;
  lastPage:    number;
  total:       number;
  loading:     boolean;
  submitting:  boolean;
  error:       ApiError | null;

  // §6.8 — provider incoming requests (separate slice; own loading flag so it
  // doesn't fight with the buyer-side bookings list above)
  incomingRequests: IncomingRequests | null;
  incomingLoading:  boolean;
  incomingError:    ApiError | null;
  fetchIncomingRequests: () => Promise<void>;
  clearIncomingError:    () => void;

  // Actions
  fetchBookings:  (reset?: boolean) => Promise<void>;
  loadMore:       () => Promise<void>;
  createBooking:  (params: CreateBookingParams) => Promise<Booking>;
  pay:            (id: string) => Promise<Booking>;
  start:          (id: string) => Promise<Booking>;
  deliver:        (id: string) => Promise<Booking>;
  complete:       (id: string) => Promise<Booking>;
  dispute:        (id: string, params: OpenDisputeParams) => Promise<Booking>;
  cancel:         (id: string) => Promise<Booking>;
  clearError:     () => void;
  reset:          () => void;
}

const initialState = {
  bookings:   [],
  page:       1,
  lastPage:   1,
  total:      0,
  loading:    false,
  submitting: false,
  error:      null,

  incomingRequests: null,
  incomingLoading:  false,
  incomingError:    null,
};

/** Replace or insert a booking in the list by id. */
function upsert(list: Booking[], updated: Booking): Booking[] {
  const idx = list.findIndex((b) => b.id === updated.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = updated;
    return next;
  }
  return [updated, ...list];
}

export const useBookingStore = create<BookingState>((set, get) => ({
  ...initialState,

  clearError: () => set({ error: null }),
  clearIncomingError: () => set({ incomingError: null }),

  reset: () => set(initialState),

  fetchIncomingRequests: async () => {
    set({ incomingLoading: true, incomingError: null });
    try {
      const incomingRequests = await bookingsApi.incomingRequests();
      set({ incomingRequests });
    } catch (e) {
      set({ incomingError: toApiError(e) });
    } finally {
      set({ incomingLoading: false });
    }
  },

  fetchBookings: async (reset = true) => {
    const page = reset ? 1 : get().page;
    set({ loading: true, error: null });
    try {
      const result: PaginatedBookings = await bookingsApi.list(page);
      set((s) => ({
        bookings: reset ? result.data : [...s.bookings, ...result.data],
        page:     result.current_page,
        lastPage: result.last_page,
        total:    result.total,
      }));
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ loading: false });
    }
  },

  loadMore: async () => {
    const { page, lastPage, loading } = get();
    if (loading || page >= lastPage) return;
    set((s) => ({ page: s.page + 1 }));
    await get().fetchBookings(false);
  },

  createBooking: async (params) => {
    set({ submitting: true, error: null });
    try {
      const booking = await bookingsApi.create(params);
      set((s) => ({ bookings: [booking, ...s.bookings], total: s.total + 1 }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false });
    }
  },

  pay: async (id) => {
    set({ submitting: true, error: null });
    try {
      const booking = await bookingsApi.pay(id);
      set((s) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false });
    }
  },

  start: async (id) => {
    set({ submitting: true, error: null });
    try {
      const booking = await bookingsApi.start(id);
      set((s) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false });
    }
  },

  deliver: async (id) => {
    set({ submitting: true, error: null });
    try {
      const booking = await bookingsApi.deliver(id);
      set((s) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false });
    }
  },

  complete: async (id) => {
    set({ submitting: true, error: null });
    try {
      const booking = await bookingsApi.complete(id);
      set((s) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false });
    }
  },

  dispute: async (id, params) => {
    set({ submitting: true, error: null });
    try {
      const { booking } = await bookingsApi.dispute(id, params);
      set((s) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false });
    }
  },

  cancel: async (id) => {
    set({ submitting: true, error: null });
    try {
      const booking = await bookingsApi.cancel(id);
      set((s) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false });
    }
  },
}));
