'use client'

import { create } from 'zustand'

export type QueueModule = 'verification' | 'finance' | 'safety' | 'reviews' | 'services'

interface QueueBadgeState {
  counts: Record<QueueModule, number>
  /** Hydrate from a REST list endpoint's total once, on first load. */
  setCount: (module: QueueModule, count: number) => void
  /** Bump on a realtime event; the module clears it when the user views the queue. */
  increment: (module: QueueModule) => void
  clear: (module: QueueModule) => void
}

export const useQueueBadgeStore = create<QueueBadgeState>((set) => ({
  counts: { verification: 0, finance: 0, safety: 0, reviews: 0, services: 0 },
  setCount: (module, count) =>
    set((s) => ({ counts: { ...s.counts, [module]: count } })),
  increment: (module) =>
    set((s) => ({ counts: { ...s.counts, [module]: s.counts[module] + 1 } })),
  clear: (module) => set((s) => ({ counts: { ...s.counts, [module]: 0 } })),
}))
