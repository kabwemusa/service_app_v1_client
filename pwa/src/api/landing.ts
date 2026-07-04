import { api } from './client';

// Public marketing summary for the landing page — real platform numbers and
// real reviews from completed bookings (masked reviewer names, server-side).

export interface LandingReview {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  reviewer: string;
  service: string | null;
}

export interface LandingSummary {
  stats: {
    providers: number;
    jobs_done: number;
    reviews: number;
    avg_rating: number | null;
  };
  reviews: LandingReview[];
}

export const landingApi = {
  summary: () => api.get<LandingSummary>('/landing'),
};
