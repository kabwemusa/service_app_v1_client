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

/**
 * Photo/video the customer attaches to a quote-first brief for pricing
 * context. `path` is a raw storage path — build the viewable URL with
 * `storageUrl(path)` (same convention as service photos).
 */
export interface ScopeBriefAttachment {
  path: string;
  type: 'image' | 'video';
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
  /** ZMW the customer saved via a Growth & Promotions campaign (0 = none). The
   *  provider payout is unaffected — Sebenza absorbs it. */
  campaign_discount_zmw?:  number;
  promo_code?:             string | null;
  // ── Outcome-based pricing ──
  scope_brief?:            ScopeBriefEntry[] | null;
  scope_brief_attachments?: ScopeBriefAttachment[];
  provider_quote?:         ProviderQuote | null;
  /** @deprecated HOURLY_CAPPED now uses the observed timer below, not a self-report. */
  actual_hours_logged?:    number | null;
  actual_charge_zmw?:      number | null;
  // ── HOURLY_CAPPED observed timer (server timestamps; never a self-report) ──
  /** Set when the provider taps "Start job"; the customer sees a live elapsed clock. */
  job_started_at?:         string | null;
  /** Set when the provider taps "Finish". */
  job_ended_at?:           string | null;
  /** Server-computed billable minutes (source of truth). */
  observed_minutes?:       number | null;
  /** Final charge = observed time rounded up, ≥ minimum, ≤ approved cap. */
  final_charge_zmw?:       number | null;
  /** [{paused_at, resumed_at}] audit trail. */
  pause_events?:           { paused_at: string; resumed_at: string | null }[];
  /** The cap the customer approved (= held amount): original cap + any extension. */
  approved_cap_zmw?:       number | null;
  cap_extension_zmw?:      number | null;
  /** Set while the provider is waiting on the customer to approve more time. */
  cap_extension_requested_at?: string | null;
  /** Fraction of the cap at which both parties get the cap-approach prompt. */
  cap_warn_ratio?:         number;
  /** Billing increment (mins) observed time rounds up to — from server config. */
  hourly_rounding_mins?:   number;
  /** Remote (online) service → show "Online" instead of an area/distance. */
  is_remote?:              boolean | null;
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
  /** Most recent structured status update — drives the live status banner. */
  last_update?: {
    type:        string;   // ON_MY_WAY | ARRIVED | RUNNING_LATE | JOB_STARTED | …
    actor_role:  'provider' | 'customer';
    body:        string;   // fully-rendered text ("…running about 15 min late.")
    eta_minutes: number | null;
    at:          string;
  } | null;
  service: {
    id:              string;
    title:           string;
    delivery_type?:  'IN_PERSON' | 'REMOTE';
    is_remote?:      boolean;
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
  /**
   * Provider-only net-payout preview (price − platform fee = net). Server-computed
   * via the same engine the real payout runs through; null for the customer.
   */
  earnings?: {
    gross:           number;
    platform_fee:    number;
    net_payout:      number;
    commission_rate: number;
    is_direct:       boolean;
  } | null;
  transactions?: Transaction[];
  commission?:   Commission | null;
  dispute?:      Dispute | null;
  /** Communication layer + agreement — present for a party of the booking. */
  comms?:        BookingComms | null;
  created_at:    string;
  updated_at:    string;
}

// ── Communication layer + Booking Agreement (comms block on Booking) ────────

/** One tap-to-send status-update preset available to the viewer right now. */
export interface BookingCommsOption {
  type:        string;
  label:       string;
  requires?:   'duration' | 'note';
  durations?:  number[];    // RUNNING_LATE — offered delay times (minutes)
  max_length?: number;      // LOCATION_NOTE — note character cap
  drives?:     'start' | 'finish'; // ties into the lifecycle (HOURLY_CAPPED timer)
}

export interface BookingComms {
  /** Masked calling available (funded + active, within the dispute window). */
  call_enabled:           boolean;
  status_update_options:  BookingCommsOption[];
  agreement: {
    version:      number;
    generated_at: string;
    format:       string;
    title:        string;
    download_url: string;
  } | null;
}

/** Result of starting a masked call. Real numbers appear ONLY in reveal mode. */
export interface CallSessionResult {
  session_id:         string;
  mode:               'bridge' | 'reveal';
  status:             string;
  masked_number:      string | null;
  message:            string;
  revealed_number?:   string;      // flagged reveal fallback only
  reveal_expires_at?: string;
}

export type CommsTimelineEvent =
  | { kind: 'status_update'; type: string; actor_role: 'provider' | 'customer'; body: string; at: string }
  | { kind: 'call'; initiator_role: 'provider' | 'customer'; provider: string; status: string; duration_seconds: number | null; at: string; answered_at: string | null; ended_at: string | null };

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
  // Location is omitted entirely for remote (online) services — nationwide, no pin.
  delivery_lat?:             number;
  delivery_lng?:             number;
  delivery_location_label?:  string;
  delivery_location_region?: string | null;
  delivery_location_source?: 'DEVICE' | 'SEARCH' | 'SAVED';
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
  avatar_url:   string | null;
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

  // Quote-first brief (PROVIDER_SCOPE / QUOTE_DEPOSIT): attach photos/a short
  // video so the provider has visual context to price the job. Buyer-only,
  // brief must still be open (SCOPE_PENDING/QUOTE_SENT).
  addScopeAttachments: (id: string, assets: { uri: string; name: string; mimeType: string }[]) => {
    const formData = new FormData();
    assets.forEach((asset) => {
      formData.append('files[]', { uri: asset.uri, name: asset.name, type: asset.mimeType } as any);
    });
    return api.upload<Booking>(`/bookings/${id}/scope-attachments`, formData);
  },

  // ESCROW: initiate MoMo pay-in. `momoNumber` optionally sends the collection
  // request to a different Mobile Money wallet than the account phone.
  // `promoCode` optionally applies a Growth & Promotions code at checkout — the
  // server computes and applies the discount (client never decides eligibility).
  pay: (id: string, momoNumber?: string, promoCode?: string) =>
    api.post<Booking>(`/bookings/${id}/pay`, {
      ...(momoNumber ? { momo_number: momoNumber } : {}),
      ...(promoCode ? { promo_code: promoCode } : {}),
    }),

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
  approveQuote: (id: string, momoNumber?: string, promoCode?: string) =>
    api.post<Booking>(`/bookings/${id}/approve-quote`, {
      ...(momoNumber ? { momo_number: momoNumber } : {}),
      ...(promoCode ? { promo_code: promoCode } : {}),
    }),

  // Customer declines the scoped quote — booking cancelled, nothing charged.
  declineQuote: (id: string) =>
    api.post<Booking>(`/bookings/${id}/decline-quote`, {}),

  // DIRECT: provider declines
  decline: (id: string) =>
    api.post<Booking>(`/bookings/${id}/decline`, {}),

  // DIRECT: record that direct payment was made
  markPaid: (id: string) =>
    api.post<Booking>(`/bookings/${id}/mark-paid`, {}),

  // HOURLY_CAPPED "Start job": records the server start time (job_started_at).
  // For other models this simply moves the booking to IN_PROGRESS.
  start: (id: string) =>
    api.post<Booking>(`/bookings/${id}/start`, {}),

  // HOURLY_CAPPED "Finish": the elapsed time is computed server-side from the
  // start/stop timestamps — no hours are ever entered.
  deliver: (id: string) =>
    api.post<Booking>(`/bookings/${id}/deliver`, {}),

  // HOURLY_CAPPED observed timer — pause/resume + customer-approved cap extension.
  pauseTimer: (id: string) =>
    api.post<Booking>(`/bookings/${id}/pause`, {}),
  resumeTimer: (id: string) =>
    api.post<Booking>(`/bookings/${id}/resume`, {}),
  requestCapExtension: (id: string) =>
    api.post<Booking>(`/bookings/${id}/request-cap-extension`, {}),
  approveCapExtension: (id: string, additionalHours: number, momoNumber?: string) =>
    api.post<Booking>(`/bookings/${id}/approve-cap-extension`, {
      additional_hours: additionalHours,
      ...(momoNumber ? { momo_number: momoNumber } : {}),
    }),

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

  // ── Communication layer ───────────────────────────────────────────────────

  /** Send one preset status update ("On my way", etc.). Returns the fresh booking. */
  statusUpdate: (id: string, type: string, extra?: { duration_mins?: number; note?: string }) =>
    api.post<Booking>(`/bookings/${id}/status-update`, { type, ...(extra ?? {}) }),

  /** Start a masked voice call to the other party. Real numbers are never returned (bridge mode). */
  call: (id: string) =>
    api.post<CallSessionResult>(`/bookings/${id}/call`, {}),

  /** A short-lived signed URL to open/download the latest Booking Agreement PDF. */
  agreementLink: (id: string) =>
    api.get<{ url: string; filename: string; version: number }>(`/bookings/${id}/agreement/link`),

  /** Chronological, PII-free feed of the booking's communication events. */
  commsTimeline: (id: string) =>
    api.get<CommsTimelineEvent[]>(`/bookings/${id}/comms/timeline`),
};
