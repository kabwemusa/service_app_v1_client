import { api } from './client';

export interface ServicePhoto {
  id:            number;
  path:          string;   // relative path — use storageUrl(path) to render
  display_order: number;
}

export interface Service {
  id:          string;
  provider_id: string;
  category_id: number;
  category:    { id: number; name: string; icon_url: string | null } | null;
  title:       string;
  description: string | null;
  base_price:  number;
  is_active:   boolean;
  latitude:    number | null;
  longitude:   number | null;
  distance_km: number | null;
  provider: {
    id:              string;
    r_raw:           number;
    v_reviews:       number;
    completion_rate: number;
  } | null;
  photos:     ServicePhoto[];
  created_at: string;
}

export interface ServicePayload {
  category_id: number;
  title:       string;
  description?: string;
  base_price:  number;
  latitude:    number;
  longitude:   number;
  is_active?:  boolean;
}

export interface PaginatedServices {
  data:          Service[];
  current_page:  number;
  last_page:     number;
  per_page:      number;
  total:         number;
}

export const servicesApi = {
  list:   (params?: { category_id?: number }) =>
    api.get<PaginatedServices>('/services', { params }),

  show:   (id: string) =>
    api.get<Service>(`/services/${id}`),

  // Provider-only
  mine:   () =>
    api.get<PaginatedServices>('/provider/services'),

  create: (payload: ServicePayload) =>
    api.post<Service>('/provider/services', payload),

  update: (id: string, payload: Partial<ServicePayload>) =>
    api.put<Service>(`/provider/services/${id}`, payload),

  remove: (id: string) =>
    api.delete<null>(`/provider/services/${id}`),

  uploadPhoto: (id: string, formData: FormData) =>
    api.upload<ServicePhoto>(`/provider/services/${id}/photos`, formData),

  deletePhoto: (serviceId: string, photoId: number) =>
    api.delete<null>(`/provider/services/${serviceId}/photos/${photoId}`),
};
