import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const KEY       = 'recent_searches_v1';
const MAX_ITEMS = 8;

export interface RecentSearch {
  query:     string;
  timestamp: number;
}

interface RecentSearchState {
  recents:  RecentSearch[];
  hydrated: boolean;
  hydrate:  () => Promise<void>;
  push:     (query: string) => void;
  remove:   (query: string) => void;
  clear:    () => void;
}

async function persist(items: RecentSearch[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // storage failures are non-fatal
  }
}

export const useRecentSearchStore = create<RecentSearchState>((set, get) => ({
  recents:  [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const items: RecentSearch[] = raw ? JSON.parse(raw) : [];
      set({ recents: items, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  push: (query: string) => {
    const q = query.trim();
    if (!q) return;
    const filtered = get().recents.filter((r) => r.query.toLowerCase() !== q.toLowerCase());
    const next = [{ query: q, timestamp: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
    set({ recents: next });
    persist(next);
  },

  remove: (query: string) => {
    const next = get().recents.filter((r) => r.query !== query);
    set({ recents: next });
    persist(next);
  },

  clear: () => {
    set({ recents: [] });
    persist([]);
  },
}));
