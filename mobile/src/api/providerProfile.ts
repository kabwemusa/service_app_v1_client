import { api } from './client';

export interface ProviderProfile {
  user_id:              string;
  display_name:         string | null;
  bio:                  string | null;
  nrc_number:           string | null;
  student_id_url:       string | null;
  kyc_status:           'PENDING' | 'VERIFIED' | 'REJECTED';
  momo_provider:        'MTN' | 'AIRTEL' | 'ZAMTEL' | null;
  momo_number:          string | null;
  base_location_lat:    number | null;
  base_location_lng:    number | null;
  max_radius_km:        number;
  availability_matrix:  Record<string, { start: string; end: string }[]> | null;
  profile_completeness: number;
}

export interface ProfilePayload {
  display_name?:      string;
  bio?:               string;
  nrc_number?:        string;
  momo_provider?:     'MTN' | 'AIRTEL' | 'ZAMTEL';
  momo_number?:       string;
  base_location_lat?: number;
  base_location_lng?: number;
  max_radius_km?:     number;
  availability_matrix?: Record<string, { start: string; end: string }[]>;
}

export const providerProfileApi = {
  get: () =>
    api.get<ProviderProfile>('/provider/profile'),

  upsert: (payload: ProfilePayload) =>
    api.put<ProviderProfile>('/provider/profile', payload),

  uploadKyc: (uri: string) => {
    const formData = new FormData();
    const fileName = uri.split('/').pop() ?? 'student_id.jpg';
    const fileType = fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    // React Native FormData accepts this shape for file uploads
    (formData as any).append('student_id', { uri, name: fileName, type: fileType });
    return api.upload<ProviderProfile>('/provider/profile/kyc', formData);
  },
};
