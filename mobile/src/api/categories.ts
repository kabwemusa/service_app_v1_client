import { api } from './client';

export interface Category {
  id:        number;
  name:      string;
  icon_url:  string | null;
  is_active: boolean;
}

export const categoriesApi = {
  list: () => api.get<Category[]>('/categories'),
};
