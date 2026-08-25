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
  /**
   * Id of the booking whose action is in flight, or null.
   *
   * `submitting` alone is a single global flag, which is fine on the
   * single-booking screens but wrong in a LIST: tapping "Pay now" on one row lit
   * the spinner on every row and disabled every other row's actions. List
   * screens must key their busy state on this instead.
   */
  submittingId: string | null;
  error:       ApiError | null;

  // §6.8 — provider incoming requests (separate slice)
  incomingRequests: IncomingRequests | null;
  incomingLoading:  boolean;
  incomingError:    ApiError | null;
  fetchIncomingRequests: () => Promise<void>;
  clearIncomingError:    () => void;

  // Actions
  fetchBookings:  (reset?: boolean) => Promise<void>;
  loadMore:       () => Promise<void>;
  createBooking:  (params: CreateBookingParams) => Promise<Booking>;

  // ESCROW action — momoNumber optionally targets a different wallet than the account phone
  pay:            (id: string, momoNumber?: string) => Promise<Booking>;

  // DIRECT actions (provider side)
  accept:         (id: string) => Promise<Booking>;
  quote:          (id: string, quotedAmount: number, extras?: { duration_mins?: number; inclusions?: string[]; message?: string }) => Promise<Booking>;
  decline:        (id: string) => Promise<Booking>;

  // DIRECT actions (buyer side)
  acceptQuote:    (id: string) => Promise<Booking>;
  markPaid:       (id: string) => Promise<Booking>;

  // Outcome-based pricing — scoped-quote approval (escrow holds only after approval)
  approveQuote:   (id: string, momoNumber?: string) => Promise<Booking>;
  declineQuote:   (id: string) => Promise<Booking>;

  // Shared actions
  start:          (id: string) => Promise<Booking>;
  /** HOURLY_CAPPED "Finish": elapsed time is computed server-side — no hours input. */
  deliver:        (id: string) => Promise<Booking>;
  // HOURLY_CAPPED observed timer — pause/resume + the customer-authorised cap raise.
  pauseTimer:          (id: string) => Promise<Booking>;
  resumeTimer:         (id: string) => Promise<Booking>;
  requestCapExtension: (id: string) => Promise<Booking>;
  approveCapExtension: (id: string, additionalHours: number, momoNumber?: string) => Promise<Booking>;
  complete:       (id: string) => Promise<Booking>;
  dispute:        (id: string, params: OpenDisputeParams) => Promise<Booking>;
  cancel:         (id: string) => Promise<Booking>;
  review:         (id: string, rating: number, comment?: string) => Promise<Booking>;
  clearError:     () => void;
  reset:          () => void;
}

const initialState = {
  bookings:   [],
  page:       1,
  lastPage:   1,
  total:      0,
  loading:      false,
  submitting:   false,
  submittingId: null,
  error:        null,

  incomingRequests: null,
  incomingLoading:  false,
  incomingError:    null,
};

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
      set((s: any) => ({
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
    set((s: any) => ({ page: s.page + 1 }));
    await get().fetchBookings(false);
  },

  createBooking: async (params) => {
    set({ submitting: true, error: null });
    try {
      const booking = await bookingsApi.create(params);
      set((s: any) => ({ bookings: [booking, ...s.bookings], total: s.total + 1 }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false });
    }
  },

  pay: async (id, momoNumber) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.pay(id, momoNumber);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  accept: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.accept(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  quote: async (id, quotedAmount, extras) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.quote(id, quotedAmount, extras);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  decline: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.decline(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  acceptQuote: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.acceptQuote(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  markPaid: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.markPaid(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  approveQuote: async (id, momoNumber) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.approveQuote(id, momoNumber);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  declineQuote: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.declineQuote(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  start: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.start(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  deliver: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.deliver(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  pauseTimer: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.pauseTimer(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  resumeTimer: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.resumeTimer(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  requestCapExtension: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.requestCapExtension(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  approveCapExtension: async (id, additionalHours, momoNumber) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.approveCapExtension(id, additionalHours, momoNumber);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  complete: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.complete(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  dispute: async (id, params) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const { booking } = await bookingsApi.dispute(id, params);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  cancel: async (id) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.cancel(id);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },

  review: async (id, rating, comment) => {
    set({ submitting: true, submittingId: id, error: null });
    try {
      const booking = await bookingsApi.review(id, rating, comment);
      set((s: any) => ({ bookings: upsert(s.bookings, booking) }));
      return booking;
    } catch (e) {
      const err = toApiError(e);
      set({ error: err });
      throw err;
    } finally {
      set({ submitting: false, submittingId: null });
    }
  },
}));
