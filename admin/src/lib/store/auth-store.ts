'use client'

import { create } from 'zustand'
import type { AdminRole, Capability } from '@/lib/api/types'

export interface AdminUser {
  id: string
  email: string
  name: string
  role: AdminRole
  capabilities: Capability[]
  avatarUrl?: string
  stepUpActive?: boolean
}

interface AuthState {
  user: AdminUser | null
  setUser: (user: AdminUser | null) => void
  clearUser: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
}))
