import { api } from './client';

// v3.2 §6 — post-a-request (reverse flow). Buyer broadcasts; the server
// notifies the top-10 matched providers; providers accept-at-price or quote;
// buyer selects; downstream booking is the unchanged standard flow.

export interface PostRequestParams {
  category_id:      number;
  description:      string;
  delivery_lat:     number;
  delivery_lng:     number;
  delivery_label?:  string;
  delivery_region?: string;
  delivery_source?: 'DEVICE' | 'SEARCH' | 'SAVED';
  window_start:     string; // ISO
  window_end:       string; // ISO
  budget_zmw?:      number;
}

export type RequestStatus = 'OPEN' | 'MATCHED' | 'EXPIRED' | 'CANCELLED';

export interface RequestResponseEntry {
  id:         string;
  type:       'ACCEPT' | 'QUOTE';
  price_zmw:  number;
  message:    string | null;
  status:     'PENDING' | 'SELECTED' | 'DECLINED';
  created_at: string;
  service:    { id: string; title: string | null };
  provider: {
    id:           string;
    display_name: string | null;
    avatar_url:   string | null;
    trust_tier:   number;
    r_raw:        number;
    v_reviews:    number;
  };
}

export interface MyServiceRequest {
  id:             string;
  category:       { id: number; name: string | null };
  description:    string;
  delivery_label: string | null;
  window_start:   string;
  window_end:     string;
  budget_zmw:     number | null;
  status:         RequestStatus;
  created_at:     string;
  response_count: number;
  responses?:     RequestResponseEntry[];
}

// Provider-side feed entry (targets on OPEN requests)
export interface ProviderRequestFeedEntry {
  request_id:      string;
  category_name:   string;
  description:     string;
  window_start:    string;
  window_end:      string;
  budget_zmw:      number | null;
  delivery_label:  string | null;
  delivery_region: string | null;
  /** 30-minute response deadline — answering inside it feeds response_rate_7d */
  respond_by:      string;
  responded_at:    string | null;
  service: {
    id:            string;
    title:         string;
    base_price:    number | null;
    pricing_model: 'FIXED' | 'HOURLY' | 'QUOTE';
  };
  my_response: { id: string; type: 'ACCEPT' | 'QUOTE'; price_zmw: number } | null;
}

export const serviceRequestsApi = {
  // Buyer
  post: (params: PostRequestParams) =>
    api.post<{ id: string; status: RequestStatus; notified_count: number }>('/service-requests', params),

  mine: () =>
    api.get<MyServiceRequest[]>('/service-requests'),

  get: (id: string) =>
    api.get<MyServiceRequest>(`/service-requests/${id}`),

  cancel: (id: string) =>
    api.post<null>(`/service-requests/${id}/cancel`, {}),

  select: (id: string, responseId: string) =>
    api.post<{
      request: MyServiceRequest;
      selected: { response_id: string; service_id: string; provider_id: string; price_zmw: number; type: string };
    }>(`/service-requests/${id}/select`, { response_id: responseId }),

  // Provider
  providerFeed: () =>
    api.get<ProviderRequestFeedEntry[]>('/provider/service-requests'),

  respond: (requestId: string, params: { type: 'ACCEPT' | 'QUOTE'; price_zmw?: number; message?: string }) =>
    api.post<{ id: string; type: string; price_zmw: number; status: string }>(
      `/provider/service-requests/${requestId}/respond`,
      params,
    ),
};
