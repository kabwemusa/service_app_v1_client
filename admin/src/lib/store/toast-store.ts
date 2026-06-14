'use client'

import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ToastState {
  toasts: ToastItem[]
  add: (item: Omit<ToastItem, 'id'>) => void
  remove: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (item) =>
    set((s) => ({
      toasts: [...s.toasts, { ...item, id: crypto.randomUUID() }],
    })),
  remove: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// Imperative helper — use outside React components
export const toast = {
  success: (message: string) =>
    useToastStore.getState().add({ type: 'success', message }),
  error: (message: string) =>
    useToastStore.getState().add({ type: 'error', message }),
  warning: (message: string) =>
    useToastStore.getState().add({ type: 'warning', message }),
  info: (message: string) =>
    useToastStore.getState().add({ type: 'info', message }),
}
