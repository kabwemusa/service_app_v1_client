import { api } from './client';

export type SafetyCategory =
  | 'HARASSMENT'
  | 'VIOLENCE_THREAT'
  | 'UNSAFE_BEHAVIOR'
  | 'DISCRIMINATION'
  | 'STOLEN_PROPERTY'
  | 'OTHER';

export interface SafetyReportParams {
  reported_id:      string;
  booking_id?:      string | null;
  category:         SafetyCategory;
  description:      string;
  tos_acknowledged: true;
}

export const safetyReportsApi = {
  file: (params: SafetyReportParams) =>
    api.post<{ id: string }>('/safety-reports', params),

  uploadEvidence: (disputeId: string, files: { uri: string; name: string; type: string }[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files[]', f as any));
    return api.upload<{ evidence: string[] }>(`/disputes/${disputeId}/evidence`, form);
  },
};
