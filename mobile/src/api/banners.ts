import { api } from './client';

export interface HomeBanner {
  id:          string;
  type:        'PROMO' | 'EVENT' | 'ADVERT' | 'ANNOUNCEMENT';
  title:       string;
  subtitle:    string | null;
  image_url:   string | null;
  bg_token:    string | null;
  cta_label:   string | null;
  cta_action:  string | null;
}

export const bannersApi = {
  list: () => api.get<HomeBanner[]>('/home-banners'),
};
