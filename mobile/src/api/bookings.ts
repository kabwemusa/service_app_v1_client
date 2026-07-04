import { api } from './client';

// ── Types ──────────────────────────────────────────────────────────────────

export type TransactionType   = 'PAY_IN' | 'PAY_OUT' | 'REFUND';
export type TransactionStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'FROZEN';

export interface Transaction {
  id:             string;
  type:           TransactionType;
  status:         TransactionStatus;
  amount_gross:   number;
  platform_fee:   number;
  amount_net:     number;
  momo_reference: string;
  retry_count:    number;
  next_retry_at:  string | null;
  created_at:     string;
}

export type PaymentMode   = 'DIRECT' | 'ESCROW';
export type PaymentStatus = 'UNPAID' | 'MARKED_PAID';

export type BookingStatus =
  // DIRECT states
  | 'REQUESTED'
  | 'QUOTED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'NO_SHOW'
  // Outcome-based pricing — quote-first models (PROVIDER_SCOPE / QUOTE_DEPOSIT)
  | 'SCOPE_PENDING'   // brief captured, awaiting provider's scoped quote
  | 'QUOTE_SENT'      // provider quoted, awaiting customer approval
  | 'DEPOSIT_HELD'    // quote-deposit: deposit custodied, balance at completion
  // Shared states
  | 'IN_PROGRESS'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED'
  // ESCROW-only states (dormant in DIRECT mode)
  | 'PENDING_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'AWAITING_KYC'
  | 'FUNDS_HELD'
  | 'DISBURSED'
  | 'CHARGEBACK_PENDING';

/** Structured brief answer (quote-first models) — never free-text hours. */
export interface ScopeBriefEntry {
  question: string;
  answer:   string;
}

/** Provider's scoped quote: price + duration + what's included. */
export interface ProviderQuote {
  price:          number;
  duration_mins:  number | null;
  inclusions:     string[];
  message:        string | null;
  quoted_at:      string;
}

export interface Commission {
  gross_amount:      number;
  commission_rate:   number;
  commission_amount: number;
  vat:               number;
  net_to_provider:   number;
  tier_at_time:      number;
  payment_mode:      PaymentMode;
  collection_status: 'COLLECTED' | 'UNCOLLECTED';
  calculated_at:     string;
}

export interface Dispute {
  id:               string;
  reason_category:  string;
  description:      string;
  status:           string;
  refund_amount:    number | null;
  resolution_notes: string | null;
  opened_at:        string;
  resolved_at:      string | null;
}

export interface Booking {
  id:                      string;
  payment_mode:            PaymentMode;
  status:                  BookingStatus;
  payment_status:          PaymentStatus | null;
  /** Two-party DIRECT settlement — each side independently confirms (null = not yet). */
  provider_marked_paid_at?: string | null;
  customer_marked_paid_at?: string | null;
  /** Final negotiated price (set when ACCEPTED). */
  agreed_amount:           number | null;
  amount:                  number | null;
  buyer_protection_fee:    number;
  // ── Outcome-based pricing ──
  scope_brief?:            ScopeBriefEntry[] | null;
  provider_quote?:         ProviderQuote | null;
  /** HOURLY_CAPPED: provider-logged actual time + final charge. */
  actual_hours_logged?:    number | null;
  actual_charge_zmw?:      number | null;
  /** QUOTE_DEPOSIT two-phase escrow. */
  deposit_amount?:         number | null;
  balance_amount?:         number | null;
  escrow_phase?:           'FULL' | 'DEPOSIT' | 'BALANCE' | null;
  payout_eligible_at:      string | null;
  /** Expiry deadline for REQUESTED state (DIRECT only). */
  expires_at:              string | null;
  instant_payout_requested: boolean;
  scheduled_start:         string;
  scheduled_end:           string;
  completed_at:            string | null;
  disbursed_at:            string | null;
  /** Internal coordinates — never rendered in the UI (v3.1 §4.1). */
  delivery_lat:            number | null;
  delivery_lng:            number | null;
  /** Human-readable delivery label shown in the UI (v3.1 §4.2). */
  delivery_location_label?:  string | null;
  delivery_location_region?: string | null;
  /** True when the customer has already left a review (v3 §7.1). */
  has_review?: boolean;
  /** ISO timestamp at which booking auto-confirms if customer does not (DELIVERED state). */
  auto_release_at?: string | null;
  service: {
    id:              string;
    title:           string;
    pricing_model?:  'OUTCOME_FIXED' | 'PROVIDER_SCOPE' | 'HOURLY_CAPPED' | 'QUOTE_DEPOSIT';
    base_price:      number;
    hourly_rate?:    number | null;
    minimum_hours?:  number | null;
    cap_hours?:      number | null;
    cap_amount?:     number | null;
    deposit_percent?: number | null;
    category_name?:  string;
    category_icon?:  string | null;
  };
  notes?: string | null;
  buyer: {
    id:    string;
    email: string;
    /** Privacy-safe display label (never legal name). */
    name?:       string | null;
    /** Qualitative trust hint (§10.2) — never a numeric score. */
    trust_hint?: TrustHint;
  };
  provider: {
    id:            string;
    email:         string;
    display_name?: string;
    /** Public profile photo — never the KYC selfie. */
    avatar_url?:   string | null;
    trust_tier?:   number;
    /** Bayesian rating (§7.1) — null until first review. Never a trust_score. */
    rating?:       number | null;
    reviews?:      number;
    /** DIRECT mobile-money details — present only for the buyer on an active booking (gated, not public). */
    payment?: { momo_provider: 'MTN' | 'AIRTEL' | 'ZAMTEL' | null; momo_number: string | null } | null;
  };
  transactions?: Transaction[];
  commission?:   Commission | null;
  dispute?:      Dispute | null;
  created_at:    string;
  updated_at:    string;
}

export interface PaginatedBookings {
  data:         Booking[];
  current_page: number;
  last_page:    number;
  per_page:     number;
  total:        number;
}

export interface CreateBookingParams {
  service_id:                string;
  scheduled_start:           string;
  /** Optional — derived server-side from the provider's estimate/cap. Never a customer duration input. */
  scheduled_end?:            string;
  delivery_lat:              number;
  delivery_lng:              number;
  delivery_location_label:   string;
  delivery_location_region?: string | null;
  delivery_location_source:  'DEVICE' | 'SEARCH' | 'SAVED';
  /** Selected service add-on ids carried from the booking sheet (§5.3). */
  addon_ids?:                number[];
  /** Optional free-text note. */
  notes?:                    string;
  /** Structured brief answers (PROVIDER_SCOPE / QUOTE_DEPOSIT). */
  scope_brief?:              ScopeBriefEntry[];
}

export interface OpenDisputeParams {
  reason_category: string;
  description:     string;
  evidence?:       string[];
}

// §6.8 — incoming requests (provider side)
export type TrustHint = 'REPEAT_CLIENT' | 'TRUSTED' | 'NEW';

export interface IncomingRequestEntry {
  booking_id:      string;
  payment_mode:    PaymentMode;
  status:          'FUNDS_HELD' | 'DEPOSIT_HELD' | 'IN_PROGRESS' | 'REQUESTED' | 'QUOTED' | 'SCOPE_PENDING' | 'QUOTE_SENT' | 'ACCEPTED';
  service_title:   string | null;
  pricing_model:   'OUTCOME_FIXED' | 'PROVIDER_SCOPE' | 'HOURLY_CAPPED' | 'QUOTE_DEPOSIT' | null;
  scheduled_start: string | null;
  scheduled_end:   string | null;
  delivery_label:  string | null;
  delivery_region: string | null;
  distance_km:     number | null;
  gross_zmw:       number;
  net_zmw:         number;
  commission_rate: number;
  escrow_label:    string;
  buyer_label:     string;
  trust_hint:      TrustHint;
  created_at:      string | null;
}

export interface IncomingRequests {
  weekly: { this_week_zmw: number; weekly_cap_zmw: number | null };
  response_nudge: { response_rate_7d: number | null; show: boolean };
  new:       IncomingRequestEntry[];
  scheduled: IncomingRequestEntry[];
}

export interface MyProvider {
  id:           string;
  display_name: string;
  trust_tier:   number;
  r_raw:        number;
  v_reviews:    number;
}

// v3.2 §2.3 — Home "Book again" card
export interface BookAgainCard {
  booking_id:   string;
  completed_at: string | null;
  service: {
    id:            string;
    title:         string;
    pricing_model: 'OUTCOME_FIXED' | 'PROVIDER_SCOPE' | 'HOURLY_CAPPED' | 'QUOTE_DEPOSIT';
    base_price:    number | null;
    category_name: string;
  };
  provider: {
    id:           string;
    display_name: string | null;
    avatar_url:   string | null;
    trust_tier:   number;
  };
  delivery: {
    label:  string | null;
    region: string | null;
    lat:    number | null;
    lng:    number | null;
  };
}

// ── API calls ──────────────────────────────────────────────────────────────

export const bookingsApi = {
  list: (page = 1) =>
    api.get<PaginatedBookings>('/bookings', { params: { page } }),

  get: (id: string) =>
    api.get<Booking>(`/bookings/${id}`),

  create: (params: CreateBookingParams) =>
    api.post<Booking>('/bookings', params),

  // ESCROW: initiate MoMo pay-in. `momoNumber` optionally sends the collection
  // request to a different Mobile Money wallet than the account phone.
  pay: (id: string, momoNumber?: string) =>
    api.post<Booking>(`/bookings/${id}/pay`, momoNumber ? { momo_number: momoNumber } : {}),

  // DIRECT: provider accepts at listed price
  accept: (id: string) =>
    api.post<Booking>(`/bookings/${id}/accept`, {}),

  // Provider sends a quote. Scoped quote (PROVIDER_SCOPE / QUOTE_DEPOSIT):
  // price + duration + inclusions against the customer's brief.
  quote: (id: string, quotedAmount: number, extras?: { duration_mins?: number; inclusions?: string[]; message?: string }) =>
    api.post<Booking>(`/bookings/${id}/quote`, { quoted_amount: quotedAmount, ...(extras ?? {}) }),

  // DIRECT: buyer accepts provider's quote
  acceptQuote: (id: string) =>
    api.post<Booking>(`/bookings/${id}/accept-quote`, {}),

  // Outcome-based pricing: customer approves the scoped quote → escrow hold
  // (deposit for QUOTE_DEPOSIT, full amount otherwise).
  approveQuote: (id: string, momoNumber?: string) =>
    api.post<Booking>(`/bookings/${id}/approve-quote`, momoNumber ? { momo_number: momoNumber } : {}),

  // Customer declines the scoped quote — booking cancelled, nothing charged.
  declineQuote: (id: string) =>
    api.post<Booking>(`/bookings/${id}/decline-quote`, {}),

  // DIRECT: provider declines
  decline: (id: string) =>
    api.post<Booking>(`/bookings/${id}/decline`, {}),

  // DIRECT: record that direct payment was made
  markPaid: (id: string) =>
    api.post<Booking>(`/bookings/${id}/mark-paid`, {}),

  start: (id: string) =>
    api.post<Booking>(`/bookings/${id}/start`, {}),

  // HOURLY_CAPPED: the provider logs actual time here (0.5-hr steps).
  deliver: (id: string, actualHours?: number) =>
    api.post<Booking>(`/bookings/${id}/deliver`, actualHours != null ? { actual_hours: actualHours } : {}),

  complete: (id: string) =>
    api.post<Booking>(`/bookings/${id}/complete`, {}),

  dispute: (id: string, params: OpenDisputeParams) =>
    api.post<{ booking: Booking; dispute: Dispute }>(`/bookings/${id}/dispute`, params),

  cancel: (id: string) =>
    api.post<Booking>(`/bookings/${id}/cancel`, {}),

  // Buyer leaves a rating (1–5) + optional comment for a completed booking
  review: (id: string, rating: number, comment?: string) =>
    api.post<Booking>(`/bookings/${id}/review`, { rating, comment }),

  instantPayout: (id: string) =>
    api.post<Booking>(`/bookings/${id}/instant-payout`, {}),

  withdrawDispute: (disputeId: string) =>
    api.post<Dispute>(`/disputes/${disputeId}/withdraw`, {}),

  incomingRequests: () =>
    api.get<IncomingRequests>('/provider/requests'),

  myProviders: () =>
    api.get<MyProvider[]>('/me/providers'),

  bookAgain: () =>
    api.get<BookAgainCard | null>('/me/book-again'),

  /** Fetch booked time slots for a service's provider (next 14 days). */
  bookedSlots: (serviceId: string) =>
    api.get<{ slots: { start: string; end: string }[] }>(`/services/${serviceId}/booked-slots`),
};
