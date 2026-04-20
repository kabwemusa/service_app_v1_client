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
  service_id:      string;
  scheduled_start: string;
  scheduled_end:   string;
  delivery_lat:    number;
  delivery_lng:    number;
}

export interface OpenDisputeParams {
  reason_category: string;
  description:     string;
  evidence?:       string[];
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
};
