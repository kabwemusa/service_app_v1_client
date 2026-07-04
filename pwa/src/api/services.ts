import { api } from './client';

// Thin mirror of the mobile service detail contract (same /services endpoints).
// Only the fields the PWA booking sheet + detail need are typed here.

export type PricingModel = 'OUTCOME_FIXED' | 'PROVIDER_SCOPE' | 'HOURLY_CAPPED' | 'QUOTE_DEPOSIT';

export interface ServiceAddon { id: number; name: string; price: number }

export interface ServicePhoto { id: number; path: string; display_order: number }

export interface ServiceProvider {
  id:                  string;
  display_name:        string | null;
  avatar_url:          string | null;
  trust_tier:          number;
  base_location_label: string | null;
  /** Keys SUN/MON/…/SAT → [{start,end}] windows. null/empty = all days open. */
  availability_matrix: Record<string, { start: string; end: string }[]> | null;
}

export interface Service {
  id:            string;
  category:      { id: number; name: string; icon_url: string | null } | null;
  title:         string;
  description:   string | null;
  pricing_model: PricingModel;
  base_price:    number | null;
  hourly_rate:   number | null;
  minimum_hours: number | null;
  cap_amount:    number | null;
  deposit_percent: number | null;
  scope_prompts: string[];
  payment_mode:  'DIRECT' | 'ESCROW';
  duration_estimate_mins: number | null;
  provider:      ServiceProvider | null;
  addons:        ServiceAddon[];
  photos:        ServicePhoto[];
}

export const servicesApi = {
  show: (id: string) => api.get<Service>(`/services/${id}`),
  bookedSlots: (id: string) =>
    api.get<{ slots: { start: string; end: string }[] }>(`/services/${id}/booked-slots`),
};
