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

export type BookingStatus =
  | 'PENDING_PAYMENT'
  | 'AWAITING_KYC'
  | 'FUNDS_HELD'
  | 'IN_PROGRESS'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CHARGEBACK_PENDING'
  | 'DISBURSED'
  | 'CANCELLED';

export interface Commission {
  gross_amount:      number;
  commission_rate:   number;
  commission_amount: number;
  vat:               number;
  net_to_provider:   number;
  tier_at_time:      number;
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
  status:                  BookingStatus;
  amount:                  number | null;
  buyer_protection_fee:    number;
  payout_eligible_at:      string | null;
  instant_payout_requested: boolean;
  scheduled_start:         string;
  scheduled_end:           string;
  completed_at:            string | null;
  disbursed_at:            string | null;
  delivery_lat:            number | null;
  delivery_lng:            number | null;
  service: {
    id:         string;
    title:      string;
    base_price: number;
  };
  buyer: {
    id:    string;
    email: string;
  };
  provider: {
    id:    string;
    email: string;
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
  scheduled_end:             string;
  delivery_lat:              number;
  delivery_lng:              number;
  delivery_location_label:   string;
  delivery_location_region?: string | null;
  delivery_location_source:  'DEVICE' | 'SEARCH' | 'SAVED';
}

export interface OpenDisputeParams {
  reason_category: string;
  description:     string;
  evidence?:       string[];
}

// §6.8 — incoming requests (New / Scheduled), each with a derived buyer
// trust hint (§8 — qualitative only, never the raw risk score).
export type TrustHint = 'REPEAT_CLIENT' | 'TRUSTED' | 'NEW';

export interface IncomingRequestEntry {
  booking_id:       string;
  status:           'FUNDS_HELD' | 'IN_PROGRESS';
  service_title:    string | null;
  pricing_model:    'FIXED' | 'HOURLY' | 'QUOTE' | null;
  scheduled_start:  string | null;
  scheduled_end:    string | null;
  delivery_label:   string | null;
  delivery_region:  string | null;
  distance_km:      number | null;
  gross_zmw:        number;
  net_zmw:          number;
  commission_rate:  number;
  escrow_label:     string;
  buyer_label:      string;
  trust_hint:       TrustHint;
  created_at:       string | null;
}

export interface IncomingRequests {
  weekly: { this_week_zmw: number; weekly_cap_zmw: number | null };
  response_nudge: { response_rate_7d: number | null; show: boolean };
  new:       IncomingRequestEntry[];
  scheduled: IncomingRequestEntry[];
}

// §6.1 — providers this buyer has completed bookings with (Home "Your providers" shelf)
export interface MyProvider {
  id:           string;
  display_name: string;
  trust_tier:   number;
  r_raw:        number;
  v_reviews:    number;
}

// ── API calls ──────────────────────────────────────────────────────────────

export const bookingsApi = {
  list: (page = 1) =>
    api.get<PaginatedBookings>('/bookings', { params: { page } }),

  get: (id: string) =>
    api.get<Booking>(`/bookings/${id}`),

  create: (params: CreateBookingParams) =>
    api.post<Booking>('/bookings', params),

  pay: (id: string) =>
    api.post<Booking>(`/bookings/${id}/pay`, {}),

  start: (id: string) =>
    api.post<Booking>(`/bookings/${id}/start`, {}),

  deliver: (id: string) =>
    api.post<Booking>(`/bookings/${id}/deliver`, {}),

  complete: (id: string) =>
    api.post<Booking>(`/bookings/${id}/complete`, {}),

  dispute: (id: string, params: OpenDisputeParams) =>
    api.post<{ booking: Booking; dispute: Dispute }>(`/bookings/${id}/dispute`, params),

  cancel: (id: string) =>
    api.post<Booking>(`/bookings/${id}/cancel`, {}),

  instantPayout: (id: string) =>
    api.post<Booking>(`/bookings/${id}/instant-payout`, {}),

  withdrawDispute: (disputeId: string) =>
    api.post<Dispute>(`/disputes/${disputeId}/withdraw`, {}),

  incomingRequests: () =>
    api.get<IncomingRequests>('/provider/requests'),

  myProviders: () =>
    api.get<MyProvider[]>('/me/providers'),
};
