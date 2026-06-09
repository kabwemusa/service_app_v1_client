import { api } from './client';

export interface Category {
  id:              number;
  parent_id:       number | null;
  name:            string;
  slug:            string;
  synonyms:        string[];
  icon:            string | null;   // Ionicons name, e.g. 'sparkles-outline'
  icon_url:        string | null;   // full URL when set by admin
  is_active:       boolean;
  display_order:   number;
  commission_band: string;
  children:        Category[];
}

export const categoriesApi = {
  list: () => api.get<Category[]>('/categories'),
};
