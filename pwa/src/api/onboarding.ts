import { api } from './client';
import type { TierLadderData } from '../components/ui/TierLadder';

export interface OnboardingState {
  state: 'DRAFT' | 'SET_UP' | 'LIVE';
  step: string;
  collected: {
    name: string | null;
    has_avatar: boolean;
    languages: string[];
    area_label: string | null;
    has_area: boolean;
    category_id: number | null;
    service_id: string | null;
    momo_number: string | null;
    identity_status: 'PENDING' | 'VERIFIED';
  };
  chosen_service: { id: string; title: string; risk_tier: number } | null;
  eligibility: { eligible: boolean; missing: string[]; tier: number; risk_tier: number } | null;
}

export interface GoLiveResult {
  state: 'LIVE' | 'SET_UP';
  is_live: boolean;
  eligibility: { eligible: boolean; missing: string[]; tier: number; risk_tier: number };
  tier_ladder: TierLadderData;
}

// All provider-onboarding calls require the bearer token (auth=true).
export const onboardingApi = {
  state: () => api.get<OnboardingState>('/provider/onboarding', true),
  about: (body: { name?: string; languages?: string[]; latitude?: number; longitude?: number; area_label?: string }) =>
    api.post<OnboardingState>('/provider/onboarding/about', body, true),
  avatar: (file: File) => { const f = new FormData(); f.append('photo', file); return api.postForm<OnboardingState>('/provider/onboarding/avatar', f); },
  offer: (category_id: number, service_id?: string) =>
    api.post<OnboardingState>('/provider/onboarding/offer', { category_id, service_id }, true),
  identity: (nrcFront: File, nrcNumber: string, selfie: File, momoNumber: string, momoProvider = 'MTN') => {
    const f = new FormData();
    f.append('nrc_front', nrcFront);
    f.append('nrc_number', nrcNumber); // § CTR-1 — NRC number mandatory at Tier 1
    f.append('selfie', selfie);
    f.append('momo_number', momoNumber);
    f.append('momo_provider', momoProvider);
    return api.postForm<OnboardingState>('/provider/onboarding/identity', f);
  },
  service: (body: { title: string; price?: number; pricing_model?: string; availability?: unknown[]; pricing_warning_shown?: boolean; pricing_warning_overridden?: boolean }) =>
    api.post<OnboardingState>('/provider/onboarding/service', body, true),
  payout: (body: { momo_number?: string; momo_provider?: string }) =>
    api.post<OnboardingState>('/provider/onboarding/payout', body, true),
  goLive: () => api.post<GoLiveResult>('/provider/onboarding/go-live', {}, true),
};
